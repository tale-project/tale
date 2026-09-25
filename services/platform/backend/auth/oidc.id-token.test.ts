// @vitest-environment node

/**
 * The ID token as a relying party receives it: the provider library's own
 * authorize → consent → token endpoints, signed by the JWT plugin and
 * verified against the issuer's JWKS, with Tale's `createOidcProvider` as
 * the plugin under test. The first-party relying parties verify that token
 * alone and require `email` and `email_verified` in it (jose
 * `requiredClaims`). Better Auth 1.7 stopped putting the scope claims
 * there, so every "Continue with Tale" failed with `missing required
 * "email_verified" claim` — and nothing in CI minted a token: the
 * real-Postgres lane that does (`oidc-integration.ts`) is not a CI job.
 * This suite is.
 *
 * Better Auth's memory adapter stands in for Postgres. The provider's own
 * reads through `sql` answer from the same memory tables (`memorySql`).
 */

import { createHash, randomBytes } from 'node:crypto';

import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { jwt, organization } from 'better-auth/plugins';
import { createLocalJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Sql } from 'postgres';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  createOidcProvider,
  OIDC_ORGANIZATION_CLAIM,
  OIDC_SCOPES,
} from './oidc.ts';

const BASE = 'https://tale.example.com';
const ISSUER = `${BASE}/api/auth`;
const REDIRECT_URI =
  'https://identity-client.example.test/api/auth/oauth2/callback/tale';
const PERSON = {
  name: 'Ada King Lovelace',
  email: 'ada@example.test',
  password: 'identity-test-password',
};

/** The standard claims (OIDC Core §5.1) the profile and email scopes carry. */
const STANDARD_CLAIMS = [
  'name',
  'picture',
  'given_name',
  'family_name',
  'email',
  'email_verified',
];

type MemoryDb = Record<string, Record<string, unknown>[]>;

/**
 * `createOidcProvider`'s reads through `sql`, answered from the memory
 * adapter's `organization` and `member` tables: the administrator check
 * behind client registration and the membership behind the organization
 * claim. The MFA policy's membership list answers empty, so the default
 * policy (not enforced) applies. The claim's role and MFA refusals are not
 * modelled here — the unit suite and the integration lane prove them.
 */
function memorySql(db: MemoryDb): Sql {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    const members = db.member ?? [];
    if (text.startsWith('SELECT "id", "organizationId", "userId", "role"')) {
      const [organizationId, userId] = values;
      return Promise.resolve(
        members.filter(
          (row) =>
            row.organizationId === organizationId && row.userId === userId,
        ),
      );
    }
    if (text.startsWith('SELECT o."id", o."slug", m."role"')) {
      const [organizationId, userId] = values;
      const organizationRow = (db.organization ?? []).find(
        (row) => row.id === organizationId,
      );
      const memberRow = members.find(
        (row) => row.organizationId === organizationId && row.userId === userId,
      );
      return Promise.resolve(
        organizationRow && memberRow
          ? [
              {
                id: organizationRow.id,
                slug: organizationRow.slug,
                role: memberRow.role,
              },
            ]
          : [],
      );
    }
    if (text.startsWith('SELECT "organizationId" FROM "member"')) {
      return Promise.resolve([]);
    }
    return Promise.reject(new Error(`unexpected query: ${text}`));
  };
  return tag as unknown as Sql;
}

const tokenResponse = z.object({
  id_token: z.string(),
  access_token: z.string(),
});

describe('the ID token the token endpoint mints', () => {
  const db: MemoryDb = {
    user: [],
    session: [],
    account: [],
    verification: [],
    jwks: [],
    organization: [],
    member: [],
    invitation: [],
    oauthClient: [],
    oauthAccessToken: [],
    oauthRefreshToken: [],
    oauthConsent: [],
  };
  // The JWT plugin as `createAuth` configures it, beside the provider under
  // test — the pair that signs what a relying party verifies.
  const auth = betterAuth({
    baseURL: BASE,
    basePath: '/api/auth',
    secret: 'identity-id-token-test-secret-long-enough',
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
    plugins: [
      jwt({
        disableSettingJwtHeader: true,
        jwks: { keyPairConfig: { alg: 'RS256' } },
        jwt: { issuer: ISSUER },
      }),
      createOidcProvider(memorySql(db), BASE),
      organization(),
    ],
  });
  const call = (path: string, init: RequestInit = {}) =>
    auth.handler(new Request(`${BASE}${path}`, init));
  const post = (path: string, body: unknown) =>
    call(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE, cookie },
      body: JSON.stringify(body),
    });
  let cookie = '';
  let personId = '';
  let org = { id: '', slug: 'identity' };
  let client = { id: '', secret: '' };

  function setEmailVerified(verified: boolean) {
    const row = db.user?.find((entry) => entry.id === personId);
    if (!row) throw new Error('the person was not stored');
    row.emailVerified = verified;
  }

  beforeAll(async () => {
    const signUp = await post('/api/auth/sign-up/email', PERSON);
    expect(signUp.status).toBe(200);
    personId = z
      .object({ user: z.object({ id: z.string() }) })
      .parse(await signUp.json()).user.id;
    cookie = signUp.headers
      .getSetCookie()
      .map((entry) => entry.split(';')[0])
      .join('; ');
    // Verified the way an administrator's provisioning verifies it.
    setEmailVerified(true);
    const created = await post('/api/auth/organization/create', {
      name: 'Identity',
      slug: org.slug,
    });
    expect(created.status).toBe(200);
    org = {
      ...org,
      id: z.object({ id: z.string() }).parse(await created.json()).id,
    };
    const activated = await post('/api/auth/organization/set-active', {
      organizationId: org.id,
    });
    expect(activated.status).toBe(200);
    // Registered the way the identity-client door registers one.
    const registered = z
      .object({ client_id: z.string(), client_secret: z.string() })
      .parse(
        await auth.api.adminCreateOAuthClient({
          headers: new Headers({ cookie }),
          body: {
            client_name: 'Identity client',
            software_id: 'identity-client',
            redirect_uris: [REDIRECT_URI],
            scope: OIDC_SCOPES.join(' '),
            grant_types: ['authorization_code'],
            response_types: ['code'],
            token_endpoint_auth_method: 'client_secret_post',
            application_type: 'web',
            require_pkce: true,
            skip_consent: false,
            metadata: { taleOrganizationId: org.id },
          },
        }),
      );
    client = { id: registered.client_id, secret: registered.client_secret };
  });

  /** The authorization code flow with S256 PKCE, a nonce and consent. */
  async function exchange(scopes: readonly string[]) {
    const verifier = randomBytes(32).toString('base64url');
    const nonce = randomBytes(16).toString('base64url');
    const state = randomBytes(16).toString('base64url');
    const authorize = await call(
      `/api/auth/oauth2/authorize?${new URLSearchParams({
        client_id: client.id,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: scopes.join(' '),
        state,
        nonce,
        code_challenge: createHash('sha256')
          .update(verifier)
          .digest('base64url'),
        code_challenge_method: 'S256',
      }).toString()}`,
      {
        headers: { cookie, Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate' },
        redirect: 'manual',
      },
    );
    let location = new URL(authorize.headers.get('location') ?? '/', BASE);
    if (location.pathname === '/oauth/consent') {
      const consent = await post('/api/auth/oauth2/consent', {
        accept: true,
        oauth_query: location.search.slice(1),
      });
      expect(consent.status).toBe(200);
      location = new URL(
        z.object({ url: z.string() }).parse(await consent.json()).url,
      );
    }
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get('state')).toBe(state);
    const code = location.searchParams.get('code') ?? '';
    expect(code).not.toBe('');
    const response = await call('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: client.id,
        client_secret: client.secret,
        redirect_uri: REDIRECT_URI,
        code,
        code_verifier: verifier,
      }),
    });
    return { response, nonce };
  }

  /** The tokens, with the ID token verified as a relying party verifies it. */
  async function signIn(
    scopes: readonly string[],
    requiredClaims: string[] = [],
  ): Promise<{ payload: JWTPayload; accessToken: string; nonce: string }> {
    const { response, nonce } = await exchange(scopes);
    expect(response.status).toBe(200);
    const tokens = tokenResponse.parse(await response.json());
    const jwks = await call('/api/auth/jwks');
    const keySet = createLocalJWKSet(
      z
        .object({ keys: z.array(z.record(z.string(), z.unknown())) })
        .parse(await jwks.json()),
    );
    const { payload } = await jwtVerify(tokens.id_token, keySet, {
      issuer: ISSUER,
      audience: client.id,
      algorithms: ['RS256'],
      requiredClaims,
    });
    return { payload, accessToken: tokens.access_token, nonce };
  }

  const standardClaims = (claims: Record<string, unknown>) =>
    Object.fromEntries(
      STANDARD_CLAIMS.filter((name) => name in claims).map((name) => [
        name,
        claims[name],
      ]),
    );

  it('carries the verified email and the profile for the scopes a Tale client requests', async () => {
    const { payload, nonce } = await signIn(OIDC_SCOPES, [
      'email',
      'email_verified',
    ]);
    expect(payload).toMatchObject({
      sub: personId,
      nonce,
      email: PERSON.email,
      email_verified: true,
      name: PERSON.name,
      given_name: 'Ada King',
      family_name: 'Lovelace',
      [OIDC_ORGANIZATION_CLAIM]: { id: org.id, slug: org.slug, role: 'owner' },
    });
    // The account has no image: the claim is absent, never null.
    expect(payload).not.toHaveProperty('picture');
  });

  it('agrees with userinfo on every standard claim', async () => {
    const { payload, accessToken } = await signIn(OIDC_SCOPES);
    const userinfo = await call('/api/auth/oauth2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(userinfo.status).toBe(200);
    const info = z.record(z.string(), z.unknown()).parse(await userinfo.json());
    expect(standardClaims(payload)).toStrictEqual(standardClaims(info));
    expect(Object.keys(standardClaims(payload))).toHaveLength(5);
  });

  it('leaves the email out without the email scope, and the profile out without the profile scope', async () => {
    const { payload: profileOnly } = await signIn([
      'openid',
      'profile',
      'tale:organization',
    ]);
    expect(profileOnly).toHaveProperty('name', PERSON.name);
    expect(profileOnly).not.toHaveProperty('email');
    expect(profileOnly).not.toHaveProperty('email_verified');

    const { payload: emailOnly } = await signIn(
      ['openid', 'email', 'tale:organization'],
      ['email', 'email_verified'],
    );
    expect(emailOnly).toMatchObject({
      email: PERSON.email,
      email_verified: true,
    });
    for (const name of ['name', 'given_name', 'family_name', 'picture']) {
      expect(emailOnly).not.toHaveProperty(name);
    }
  });

  it('still mints no identity for an unverified email', async () => {
    setEmailVerified(false);
    try {
      const { response } = await exchange(OIDC_SCOPES);
      expect(response.status).toBe(403);
    } finally {
      setEmailVerified(true);
    }
  });
});
