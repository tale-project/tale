// @vitest-environment node

/**
 * The access token a coding agent presents at the MCP endpoint [AGCONN-R15]:
 * proved against the keys the sign-in server publishes, for this endpoint
 * alone, with nothing else accepted in its shape.
 */

import {
  exportJWK,
  generateKeyPair,
  type JSONWebKeySet,
  type JWK,
  SignJWT,
} from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  agentIssuer,
  looksLikeJwt,
  verifyAgentAccessToken,
} from './agent-token.ts';

const ISSUER = 'https://tale.example.test/api/auth';
const MCP = 'https://tale.example.test/api/v1/mcp';
const MCP_OTHER = 'https://tale-b.example.test/api/v1/mcp';
const ORGANIZATION = 'https://tale.dev/organization';
const NOW = Math.floor(Date.now() / 1000);

let signer: CryptoKey;
let stranger: CryptoKey;
let keys: JSONWebKeySet;

beforeAll(async () => {
  const mine = await generateKeyPair('RS256');
  const other = await generateKeyPair('RS256');
  signer = mine.privateKey;
  stranger = other.privateKey;
  const jwk: JWK = {
    ...(await exportJWK(mine.publicKey)),
    kid: 'kid-1',
    alg: 'RS256',
  };
  keys = { keys: [jwk] };
});

interface Mint {
  /** Leave the issue time out of the token altogether. */
  noIssuedAt?: boolean;
  key?: CryptoKey;
  kid?: string;
  alg?: string;
  typ?: string;
  issuer?: string;
  audience?: string | string[];
  iat?: number;
  exp?: number;
  claims?: Record<string, unknown>;
}

/** An access token as the sign-in server makes one, unless `claims` or the
 * other knobs say otherwise. */
async function mint(options: Mint = {}): Promise<string> {
  const claims: Record<string, unknown> = {
    sub: 'user-ada',
    azp: 'https://claude.example.test/client.json',
    client_id: 'https://claude.example.test/client.json',
    scope: 'tale:mcp tale:automations.write offline_access',
    [ORGANIZATION]: { id: 'org-acme', slug: 'acme', role: 'developer' },
    ...options.claims,
  };
  const jwt = new SignJWT(claims)
    .setProtectedHeader({
      alg: options.alg ?? 'RS256',
      typ: options.typ ?? 'at+jwt',
      kid: options.kid ?? 'kid-1',
    })
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? MCP)
    .setExpirationTime(options.exp ?? NOW + 300)
    .setJti('jti-1');
  if (options.noIssuedAt !== true) jwt.setIssuedAt(options.iat ?? NOW);
  return jwt.sign(options.key ?? signer);
}

function deps(
  overrides: {
    resources?: string[];
    jwks?: () => Promise<JSONWebKeySet | undefined>;
  } = {},
) {
  return {
    issuer: ISSUER,
    resources: overrides.resources ?? [MCP, MCP_OTHER],
    jwks: overrides.jwks ?? (() => Promise.resolve(keys)),
    // A fresh object per call, so no test sees another's cached keys.
    cacheKey: {},
  };
}

describe('a token this server issued for this endpoint [AGCONN-R15]', () => {
  it('opens it, and says whose connection it is, for which app and organization and with what access', async () => {
    const verdict = await verifyAgentAccessToken(await mint(), deps());
    expect(verdict).toEqual({
      ok: true,
      token: {
        userId: 'user-ada',
        clientId: 'https://claude.example.test/client.json',
        organizationId: 'org-acme',
        scopes: ['tale:mcp', 'tale:automations.write', 'offline_access'],
        issuedAtMs: NOW * 1000,
      },
    });
  });

  it('takes the endpoint on any address the deployment answers on', async () => {
    const verdict = await verifyAgentAccessToken(
      await mint({ audience: MCP_OTHER }),
      deps(),
    );
    expect(verdict.ok).toBe(true);
  });

  it('takes a token that names the endpoint among other audiences', async () => {
    const verdict = await verifyAgentAccessToken(
      await mint({ audience: [`${ISSUER}/oauth2/userinfo`, MCP] }),
      deps(),
    );
    expect(verdict.ok).toBe(true);
  });
});

describe('a token that is not one [AGCONN-R15]', () => {
  const invalid = { ok: false, reason: 'invalid' } as const;

  it('is refused when another signer made it, when its key is not published and when the signature was altered', async () => {
    expect(
      await verifyAgentAccessToken(await mint({ key: stranger }), deps()),
    ).toMatchObject(invalid);
    expect(
      await verifyAgentAccessToken(await mint({ kid: 'kid-unknown' }), deps()),
    ).toMatchObject(invalid);
    const good = await mint();
    const [header, payload, signature] = good.split('.');
    const altered = `${header}.${payload}.${signature?.slice(0, -4)}AAAA`;
    expect(await verifyAgentAccessToken(altered, deps())).toMatchObject(
      invalid,
    );
  });

  it('is refused when another issuer named itself, or it was made for another endpoint', async () => {
    expect(
      await verifyAgentAccessToken(
        await mint({ issuer: 'https://evil.example.test/api/auth' }),
        deps(),
      ),
    ).toMatchObject(invalid);
    expect(
      await verifyAgentAccessToken(
        await mint({ audience: `${ISSUER}/oauth2/userinfo` }),
        deps(),
      ),
    ).toMatchObject(invalid);
    expect(
      await verifyAgentAccessToken(
        await mint({ audience: 'https://elsewhere.example.test/api/v1/mcp' }),
        deps(),
      ),
    ).toMatchObject(invalid);
  });

  it('is refused when the deployment answers on no address, so no endpoint is anyone’s audience, and asks for no keys', async () => {
    const jwks = vi.fn(() => Promise.resolve(keys));
    expect(
      await verifyAgentAccessToken(await mint(), deps({ resources: [], jwks })),
    ).toMatchObject(invalid);
    expect(jwks).not.toHaveBeenCalled();
  });

  it('is refused when it is signed with an algorithm other than RS256, even by a key that names none', async () => {
    // The sign-in server publishes its keys with their algorithm; a key set
    // that did not would otherwise accept whatever its key type can sign.
    const pss = await generateKeyPair('PS256');
    const unnamed: JSONWebKeySet = {
      keys: [{ ...(await exportJWK(pss.publicKey)), kid: 'kid-pss' }],
    };
    const token = await mint({
      key: pss.privateKey,
      kid: 'kid-pss',
      alg: 'PS256',
    });
    expect(
      await verifyAgentAccessToken(
        token,
        deps({ jwks: () => Promise.resolve(unnamed) }),
      ),
    ).toMatchObject(invalid);
  });

  it('is refused when it is not an access token, or is signed some other way', async () => {
    expect(
      await verifyAgentAccessToken(await mint({ typ: 'JWT' }), deps()),
    ).toMatchObject(invalid);
    expect(
      await verifyAgentAccessToken(await mint({ typ: 'id_token' }), deps()),
    ).toMatchObject(invalid);
    // A token signed with a shared secret under the public key's name, and
    // one that signs nothing at all, are not accepted: only RS256 is.
    const hmac = await new SignJWT({ sub: 'user-ada' })
      .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt', kid: 'kid-1' })
      .setIssuer(ISSUER)
      .setAudience(MCP)
      .setExpirationTime(NOW + 300)
      .sign(new TextEncoder().encode('0123456789abcdef0123456789abcdef'));
    expect(await verifyAgentAccessToken(hmac, deps())).toMatchObject(invalid);
    const none = `${Buffer.from('{"alg":"none","typ":"at+jwt"}').toString('base64url')}.${Buffer.from(
      JSON.stringify({
        iss: ISSUER,
        aud: MCP,
        sub: 'user-ada',
        exp: NOW + 300,
      }),
    ).toString('base64url')}.`;
    expect(await verifyAgentAccessToken(none, deps())).toMatchObject(invalid);
  });

  it('is refused when it lacks the person, the app, the organization or the scope it must carry', async () => {
    for (const claims of [
      { sub: undefined },
      { sub: '' },
      { azp: undefined },
      { azp: '' },
      { scope: undefined },
      { scope: ['tale:mcp'] },
      { [ORGANIZATION]: undefined },
      { [ORGANIZATION]: 'org-acme' },
      { [ORGANIZATION]: { slug: 'acme' } },
      { [ORGANIZATION]: { id: '' } },
      { [ORGANIZATION]: { id: 7 } },
    ]) {
      expect(
        await verifyAgentAccessToken(await mint({ claims }), deps()),
        JSON.stringify(claims),
      ).toMatchObject(invalid);
    }
  });

  it('is refused when it does not say when it was made: a token before a connection cannot be told from one after', async () => {
    expect(
      await verifyAgentAccessToken(await mint({ noIssuedAt: true }), deps()),
    ).toMatchObject(invalid);
  });

  it('is refused when it is not a token at all', async () => {
    for (const value of ['a.b.c', '...', 'eyJ.eyJ.sig', '.']) {
      expect(await verifyAgentAccessToken(value, deps()), value).toMatchObject(
        invalid,
      );
    }
  });

  it('is refused, with its own reason, when it is bound to a key of the agent’s: this endpoint takes bearer tokens only', async () => {
    expect(
      await verifyAgentAccessToken(
        await mint({ claims: { cnf: { jkt: 'thumbprint' } } }),
        deps(),
      ),
    ).toEqual({
      ok: false,
      reason: 'unsupported',
      description: 'This endpoint accepts Bearer tokens only',
    });
  });

  it('is refused, with its own reason, when it has run out — the ordinary moment for an agent to refresh', async () => {
    expect(
      await verifyAgentAccessToken(
        await mint({ iat: NOW - 600, exp: NOW - 300 }),
        deps(),
      ),
    ).toEqual({
      ok: false,
      reason: 'expired',
      description: 'The access token has expired',
    });
  });
});

describe('the keys the sign-in server publishes [AGCONN-R15]', () => {
  it('are fetched once and kept for the tokens that follow', async () => {
    const jwks = vi.fn(() => Promise.resolve(keys));
    const shared = { ...deps({ jwks }), cacheKey: {} };
    await verifyAgentAccessToken(await mint(), shared);
    await verifyAgentAccessToken(await mint(), shared);
    expect(jwks).toHaveBeenCalledTimes(1);
  });

  it('are asked for again when a token names a key that was not there — a rotation', async () => {
    const before: JSONWebKeySet = { keys: [] };
    let published = before;
    const jwks = vi.fn(() => Promise.resolve(published));
    const shared = { ...deps({ jwks }), cacheKey: {} };
    expect(await verifyAgentAccessToken(await mint(), shared)).toMatchObject({
      ok: false,
    });
    published = keys;
    expect((await verifyAgentAccessToken(await mint(), shared)).ok).toBe(true);
  });

  it('that are malformed are an outage too: nothing a caller sent can be blamed', async () => {
    await expect(
      verifyAgentAccessToken(
        await mint(),
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a broken key set
        deps({ jwks: () => Promise.resolve({ keys: 'broken' } as never) }),
      ),
    ).rejects.toBeInstanceOf(Error);
  });

  it('that cannot be fetched are an outage, not a refusal of the token', async () => {
    const outage = new Error('connection refused');
    await expect(
      verifyAgentAccessToken(
        await mint(),
        deps({ jwks: () => Promise.reject(outage) }),
      ),
    ).rejects.toBe(outage);
  });
});

describe('telling a token from a key', () => {
  it('reads three dot-separated base64url parts as a token and anything else as a key', () => {
    expect(looksLikeJwt('eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln')).toBe(
      true,
    );
    expect(looksLikeJwt('eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.')).toBe(true);
    for (const key of [
      'tale_AbCdEf0123456789',
      'abc.def',
      'a.b.c.d',
      'a b.c.d',
      '',
      'a..c',
    ]) {
      expect(looksLikeJwt(key), key).toBe(false);
    }
  });

  it('is the auth instance’s own address and the mount of its endpoints', () => {
    expect(
      agentIssuer({ options: { baseURL: 'https://tale.example.test/' } }),
    ).toBe('https://tale.example.test/api/auth');
    expect(
      agentIssuer({ options: { baseURL: 'https://tale.example.test' } }),
    ).toBe('https://tale.example.test/api/auth');
  });
});
