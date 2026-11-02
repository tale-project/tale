import { describe, expect, it } from 'vitest';

import {
  buildAuthHeader,
  buildSecretBindings,
  parseSecretPayload,
  SecretPayloadError,
} from './auth_injection';

describe('parseSecretPayload', () => {
  it('tags a token payload with the method that stores it', () => {
    expect(parseSecretPayload('api-key', { token: 'tvly-1' })).toEqual({
      authMethod: 'api-key',
      token: 'tvly-1',
    });
    expect(parseSecretPayload('bearer', { token: 'ghp_1' })).toEqual({
      authMethod: 'bearer',
      token: 'ghp_1',
    });
  });

  it('parses the basic and oauth2 payloads with their optional fields', () => {
    expect(
      parseSecretPayload('basic', { username: 'ops', password: 'pw' }),
    ).toEqual({ authMethod: 'basic', username: 'ops', password: 'pw' });

    // imap-smtp's separate SMTP relay — both halves together, or neither.
    expect(
      parseSecretPayload('basic', {
        username: 'mailbox@example.com',
        password: 'mailbox-pw',
        smtpUsername: 'resend',
        smtpPassword: 're_key',
      }),
    ).toEqual({
      authMethod: 'basic',
      username: 'mailbox@example.com',
      password: 'mailbox-pw',
      smtpUsername: 'resend',
      smtpPassword: 're_key',
    });
    expect(() =>
      parseSecretPayload('basic', {
        username: 'ops',
        password: 'pw',
        smtpUsername: 'resend',
      }),
    ).toThrow(/smtpUsername and smtpPassword/);

    expect(
      parseSecretPayload('oauth2', {
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: 1_700_000_000_000,
        scopes: ['chat:write'],
      }),
    ).toEqual({
      authMethod: 'oauth2',
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: 1_700_000_000_000,
      scopes: ['chat:write'],
    });
  });

  it('refuses a payload shaped for a different method, naming the shape', () => {
    expect(() =>
      parseSecretPayload('api-key', { username: 'ops', password: 'pw' }),
    ).toThrow(SecretPayloadError);
    expect(() => parseSecretPayload('basic', { token: 't' })).toThrow(
      /username, password/,
    );
    expect(() => parseSecretPayload('oauth2', { token: 't' })).toThrow(
      /accessToken/,
    );
  });

  it('refuses empty and non-object payloads', () => {
    expect(() => parseSecretPayload('api-key', { token: '' })).toThrow(
      SecretPayloadError,
    );
    expect(() => parseSecretPayload('bearer', null)).toThrow(
      SecretPayloadError,
    );
    // Unknown keys are refused too: a stray field means the envelope was
    // written by something that does not agree with this contract.
    expect(() =>
      parseSecretPayload('api-key', { token: 't', extra: 1 }),
    ).toThrow(SecretPayloadError);
  });
});

describe('buildAuthHeader', () => {
  it('injects no header for api-key — the body places the secret itself', () => {
    expect(
      buildAuthHeader({ authMethod: 'api-key', token: 'tvly-1' }),
    ).toBeUndefined();
  });

  it('uses the connector scheme for bearer, defaulting to Bearer', () => {
    expect(buildAuthHeader({ authMethod: 'bearer', token: 'ghp_1' })).toBe(
      'Bearer ghp_1',
    );
    // Discord authenticates bot tokens as `Bot <token>` and rejects Bearer.
    expect(
      buildAuthHeader({ authMethod: 'bearer', token: 'MTIz.abc' }, 'Bot'),
    ).toBe('Bot MTIz.abc');
  });

  it('base64s basic credentials from their UTF-8 bytes', () => {
    expect(
      buildAuthHeader({
        authMethod: 'basic',
        username: 'ops@example.com',
        password: 'pw',
      }),
    ).toBe(`Basic ${btoa('ops@example.com:pw')}`);

    // A non-latin1 password must not throw — RFC 7617 encodes UTF-8 bytes.
    const header = buildAuthHeader({
      authMethod: 'basic',
      username: 'ops',
      password: 'pässwörd–ü',
    });
    expect(header).toMatch(/^Basic /);
    expect(
      new TextDecoder().decode(
        Uint8Array.from(atob(header?.slice(6) ?? ''), (ch) => ch.charCodeAt(0)),
      ),
    ).toBe('ops:pässwörd–ü');
  });

  it('sends an oauth2 access token as a standard Bearer token', () => {
    expect(
      buildAuthHeader(
        { authMethod: 'oauth2', accessToken: 'xoxb-1', refreshToken: 'xoxr-1' },
        // The connector's bearer scheme never applies to an oauth2 grant.
        'Bot',
      ),
    ).toBe('Bearer xoxb-1');
  });
});

describe('an app that signs in as itself (client-credentials)', () => {
  const app = {
    tenantId: 'contoso.onmicrosoft.com',
    clientId: 'app-id',
    clientSecret: 'app-secret',
  };

  it('parses the registration with or without a fetched token', () => {
    expect(parseSecretPayload('client-credentials', app)).toEqual({
      authMethod: 'client-credentials',
      ...app,
    });
    expect(
      parseSecretPayload('client-credentials', {
        ...app,
        accessToken: 'at',
        expiresAt: 5,
      }),
    ).toMatchObject({ accessToken: 'at', expiresAt: 5 });
  });

  it('refuses a directory that could leave its path segment', () => {
    for (const tenantId of ['../common', 'a/b', 'x?y=1', 'a%2Fb', '']) {
      expect(() =>
        parseSecretPayload('client-credentials', { ...app, tenantId }),
      ).toThrow(SecretPayloadError);
    }
  });

  it('sends the fetched token, never the client secret, and nothing before one is fetched', () => {
    expect(
      buildAuthHeader({
        authMethod: 'client-credentials',
        ...app,
        accessToken: 'at',
      }),
    ).toBe('Bearer at');
    expect(
      buildAuthHeader({ authMethod: 'client-credentials', ...app }),
    ).toBeUndefined();
    const bindings = buildSecretBindings({
      authMethod: 'client-credentials',
      ...app,
      accessToken: 'at',
    });
    expect(bindings).toEqual({ token: 'at', accessToken: 'at' });
    expect(Object.values(bindings)).not.toContain('app-secret');
  });
});

describe('a GitHub App the organization registered (github-app)', () => {
  // The shape of a PEM key, not a key: these tests never sign anything.
  const KEY_BODY = 'MIIEowIBAAKCAQEAsecretkeymaterial0123456789abcdef';
  const app = {
    appId: 42,
    clientId: 'Iv23liExample',
    slug: 'tale-acme',
    privateKey: `-----BEGIN RSA PRIVATE KEY-----\n${KEY_BODY}\n-----END RSA PRIVATE KEY-----\n`,
  };
  const installation = {
    id: 7,
    account: 'acme',
    accountType: 'Organization',
    repositorySelection: 'selected',
  } as const;

  it('parses the registration, before and after it is installed and a token is minted', () => {
    expect(parseSecretPayload('github-app', app)).toEqual({
      authMethod: 'github-app',
      ...app,
    });
    expect(
      parseSecretPayload('github-app', {
        ...app,
        privateKey: `-----BEGIN PRIVATE KEY-----\r\n${KEY_BODY}\r\n-----END PRIVATE KEY-----`,
        owner: 'acme',
        botId: 99,
        installation,
        accessToken: 'ghs_minted',
        expiresAt: 5,
      }),
    ).toMatchObject({
      owner: 'acme',
      botId: 99,
      installation,
      accessToken: 'ghs_minted',
      expiresAt: 5,
    });
  });

  it('[CCRED-R15] refuses a payload that is not one, naming the field and never echoing the key', () => {
    for (const [raw, field] of [
      [{ ...app, privateKey: `${KEY_BODY}-not-pem` }, 'privateKey'],
      [
        {
          ...app,
          privateKey: `-----BEGIN PUBLIC KEY-----\n${KEY_BODY}\n-----END PUBLIC KEY-----`,
        },
        'privateKey',
      ],
      [{ ...app, slug: 'Tale Acme' }, 'slug'],
      [{ ...app, appId: 0 }, 'appId'],
      [
        { ...app, installation: { ...installation, accountType: 'Team' } },
        'installation',
      ],
      [
        { ...app, installation: { ...installation, token: KEY_BODY } },
        'installation',
      ],
      [{ ...app, webhookSecret: KEY_BODY }, undefined],
    ] as const) {
      const error = (() => {
        try {
          parseSecretPayload('github-app', raw);
        } catch (thrown) {
          return thrown;
        }
        return null;
      })();
      expect(error).toBeInstanceOf(SecretPayloadError);
      expect((error as SecretPayloadError).field).toBe(field);
      expect((error as SecretPayloadError).message).not.toContain(KEY_BODY);
    }
  });

  it('[CCRED-R15] sends the minted token, never the key, and publishes nothing to a body or a sandbox', () => {
    expect(
      buildAuthHeader({
        authMethod: 'github-app',
        ...app,
        installation,
        accessToken: 'ghs_minted',
        expiresAt: Date.now() + 3_600_000,
      }),
    ).toBe('Bearer ghs_minted');
    expect(
      buildAuthHeader({ authMethod: 'github-app', ...app, installation }),
    ).toBeUndefined();
    expect(
      buildSecretBindings({
        authMethod: 'github-app',
        ...app,
        installation,
        accessToken: 'ghs_minted',
        expiresAt: 5,
      }),
    ).toEqual({});
  });

  it('[CCRED-R18] refuses to send a token that is expired or expires within the minute, never echoing it', () => {
    const now = Date.UTC(2026, 10, 2, 9, 0, 0);
    const minted = {
      authMethod: 'github-app',
      ...app,
      installation,
      accessToken: 'ghs_minted',
    } as const;
    for (const expiresAt of [now - 1, now, now + 30_000, now + 60_000, null]) {
      const error = (() => {
        try {
          buildAuthHeader(
            expiresAt === null ? minted : { ...minted, expiresAt },
            undefined,
            now,
          );
        } catch (thrown) {
          return thrown;
        }
        return null;
      })();
      expect(error).toBeInstanceOf(SecretPayloadError);
      expect((error as SecretPayloadError).field).toBe('expiresAt');
      expect((error as SecretPayloadError).message).not.toContain('ghs_minted');
    }
    expect(
      buildAuthHeader({ ...minted, expiresAt: now + 60_001 }, undefined, now),
    ).toBe('Bearer ghs_minted');
  });
});

describe('buildSecretBindings', () => {
  it('publishes an api key under every name the shipped bodies read', () => {
    // tavily reads `apiKey`; shopify reads `accessToken` — both api-key.
    expect(buildSecretBindings({ authMethod: 'api-key', token: 'k' })).toEqual({
      token: 'k',
      apiKey: 'k',
      accessToken: 'k',
    });
  });

  it('publishes a bearer token even though the header is injected', () => {
    expect(buildSecretBindings({ authMethod: 'bearer', token: 't' })).toEqual({
      token: 't',
      accessToken: 't',
    });
  });

  it('publishes the basic pair under the names twilio and confluence read', () => {
    expect(
      buildSecretBindings({
        authMethod: 'basic',
        username: 'AC123',
        password: 'secret',
      }),
    ).toEqual({ username: 'AC123', password: 'secret' });
    expect(
      buildSecretBindings({
        authMethod: 'basic',
        username: 'mailbox@example.com',
        password: 'mailbox-pw',
        smtpUsername: 'resend',
        smtpPassword: 're_key',
      }),
    ).toEqual({
      username: 'mailbox@example.com',
      password: 'mailbox-pw',
      smtpUsername: 'resend',
      smtpPassword: 're_key',
    });
  });

  it('publishes the oauth2 access token, and the refresh token only when stored', () => {
    expect(
      buildSecretBindings({ authMethod: 'oauth2', accessToken: 'at' }),
    ).toEqual({ token: 'at', accessToken: 'at' });
    expect(
      buildSecretBindings({
        authMethod: 'oauth2',
        accessToken: 'at',
        refreshToken: 'rt',
      }),
    ).toEqual({ token: 'at', accessToken: 'at', refreshToken: 'rt' });
  });
});
