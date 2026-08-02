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
