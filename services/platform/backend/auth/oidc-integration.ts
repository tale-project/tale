/** Real native session → consent → authorization code → signed identity proof. */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { deleteOrganization } from '../domains/organizations/service.ts';
import { findOrCreateSsoUser } from '../domains/sso/service.ts';
import { clearOrgConfigCaches } from '../lib/org-config.ts';
import type { Auth } from './auth.ts';
import {
  OIDC_DISABLED_PATHS,
  OIDC_ORGANIZATION_CLAIM,
  OIDC_SCOPES,
} from './oidc.ts';

const clientSchema = z.object({
  created: z.boolean(),
  client: z.object({
    client_id: z.string(),
    client_secret: z.string().optional(),
    require_pkce: z.boolean(),
    reference_id: z.string(),
  }),
});

export async function checkNativeIdentity(
  sql: Sql,
  base: string,
  auth: Auth,
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const check = (name: string, ok: boolean, detail?: string) => {
    record(`identity: ${name}`, ok, ok ? 'observed' : (detail ?? 'failed'));
    assert(ok, detail === undefined ? name : `${name} — ${detail}`);
  };
  const suffix = randomUUID().slice(0, 8);
  const issuer = `${base}/api/auth`;
  const redirectUri =
    'https://identity-client.example.test/api/auth/oauth2/callback/tale';
  const post = (route: string, body: unknown, cookie = '') =>
    fetch(`${base}${route}`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json', Origin: base, cookie },
      body: JSON.stringify(body),
    });
  const freshUser = async (label: string) => {
    const email = `identity-${label}-${suffix}@example.test`;
    const response = await post('/api/auth/sign-up/email', {
      email,
      name: `Identity ${label}`,
      password: 'identity-test-password',
    });
    assert.equal(response.status, 200, `signup ${label}`);
    const body = z
      .object({ user: z.object({ id: z.string() }) })
      .parse(await response.json());
    return {
      email,
      id: body.user.id,
      cookie: response.headers
        .getSetCookie()
        .map((entry) => entry.split(';')[0])
        .join('; '),
    };
  };
  const owner = await freshUser('owner');
  const member = await freshUser('member');
  const orgSlug = `identity-${suffix}`;
  const orgResponse = await post(
    '/api/auth/organization/create',
    { name: 'Identity test', slug: orgSlug },
    owner.cookie,
  );
  assert.equal(orgResponse.status, 200, 'create organization');
  const org = z.object({ id: z.string() }).parse(await orgResponse.json());
  await sql`INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt") VALUES (gen_random_uuid(), ${org.id}, ${member.id}, 'member', ${new Date()})`;
  await sql`UPDATE "user" SET "emailVerified" = true WHERE "id" IN (${owner.id}, ${member.id})`;
  const activate = await post(
    '/api/auth/organization/set-active',
    { organizationId: org.id },
    owner.cookie,
  );
  assert.equal(activate.status, 200);
  await post(
    '/api/auth/organization/set-active',
    { organizationId: org.id },
    member.cookie,
  );
  const clientPath = `/api/app/identity/clients?orgId=${org.id}`;
  const input = { key: 'vatplus', name: 'VATplus', redirectUri };
  const registrations = await Promise.all([
    post(clientPath, input, owner.cookie),
    post(clientPath, input, owner.cookie),
  ]);
  const registered = await Promise.all(
    registrations.map(async (response) =>
      clientSchema.parse(await response.json()),
    ),
  );
  const created = registered.find((entry) => entry.created);
  assert(created?.client.client_secret);
  const clientId = created.client.client_id;
  let secret = created.client.client_secret;
  check(
    'concurrent registration converges on one org-bound PKCE client and one secret',
    registrations
      .map((r) => r.status)
      .sort((a, b) => a - b)
      .join(',') === '200,201' &&
      registered.every(
        (r) =>
          r.client.client_id === clientId &&
          r.client.reference_id === org.id &&
          r.client.require_pkce,
      ) &&
      registered.filter((r) => r.client.client_secret).length === 1,
  );
  const stored = await sql<
    { clientSecret: string }[]
  >`SELECT "clientSecret" FROM "oauthClient" WHERE "clientId" = ${clientId}`;
  check(
    'the client secret is hashed at rest',
    Boolean(stored[0]?.clientSecret) && stored[0]?.clientSecret !== secret,
  );
  check(
    'reruns refuse a changed callback and ordinary members cannot register clients',
    (
      await post(
        clientPath,
        { ...input, redirectUri: 'https://changed.example.test/callback' },
        owner.cookie,
      )
    ).status === 409 &&
      (await post(clientPath, input, member.cookie)).status === 403 &&
      (
        await post(
          clientPath,
          {
            ...input,
            key: 'insecure',
            redirectUri: 'http://client.example.test/callback',
          },
          owner.cookie,
        )
      ).status === 400,
  );
  const untrustedOrigin = await fetch(`${base}${clientPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://evil.example.test',
      cookie: owner.cookie,
    },
    body: JSON.stringify(input),
  });
  check(
    'client administration refuses a foreign browser origin',
    untrustedOrigin.status === 403,
  );
  for (const route of OIDC_DISABLED_PATHS) {
    const response = await post(
      `/api/auth${route}`,
      { client_id: clientId },
      owner.cookie,
    );
    check(`raw ${route} is closed`, response.status === 404);
  }
  const discovery = await fetch(`${issuer}/.well-known/openid-configuration`);
  const metadata = z
    .object({
      issuer: z.string(),
      jwks_uri: z.string(),
      authorization_endpoint: z.string(),
      token_endpoint: z.string(),
      claims_supported: z.array(z.string()),
    })
    .parse(await discovery.json());
  check(
    'discovery identifies the exact native issuer and endpoints',
    metadata.issuer === issuer &&
      metadata.jwks_uri === `${issuer}/jwks` &&
      metadata.authorization_endpoint === `${issuer}/oauth2/authorize` &&
      metadata.token_endpoint === `${issuer}/oauth2/token`,
  );
  check(
    'discovery advertises the organization claim',
    metadata.claims_supported.includes(OIDC_ORGANIZATION_CLAIM),
  );
  const authServerMetadata = await fetch(
    `${base}/.well-known/oauth-authorization-server/api/auth`,
  );
  check(
    'RFC8414 path-insertion discovery reaches the same issuer',
    authServerMetadata.ok &&
      metadata.issuer ===
        z.object({ issuer: z.string() }).parse(await authServerMetadata.json())
          .issuer,
  );
  const keySet = createRemoteJWKSet(new URL(metadata.jwks_uri));
  const begin = async (
    cookie = member.cookie,
    changes: Record<string, string | null | undefined> = {},
  ) => {
    const verifier = randomBytes(32).toString('base64url');
    const nonce = randomBytes(24).toString('base64url');
    const state = randomBytes(24).toString('base64url');
    const url = new URL(metadata.authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: OIDC_SCOPES.join(' '),
      state,
      nonce,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    }).toString();
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) url.searchParams.delete(key);
      else if (value !== undefined) url.searchParams.set(key, value);
    }
    const response = await fetch(url, {
      headers: { cookie, Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate' },
      redirect: 'manual',
    });
    const returned = z.object({ url: z.string() }).safeParse(
      await response
        .clone()
        .json()
        .catch(() => null),
    );
    return {
      response,
      verifier,
      state,
      nonce,
      location:
        response.headers.get('location') ??
        (returned.success ? returned.data.url : ''),
    };
  };
  const issue = async (cookie = member.cookie) => {
    const request = await begin(cookie);
    assert(request.location, `authorize returned ${request.response.status}`);
    const location = new URL(request.location, base);
    if (location.pathname === '/oauth/consent') {
      const response = await post(
        '/api/auth/oauth2/consent',
        { accept: true, oauth_query: location.search.slice(1) },
        cookie,
      );
      assert.equal(
        response.status,
        200,
        `consent ${await response.clone().text()}`,
      );
      const body = z.object({ url: z.string() }).parse(await response.json());
      request.location = body.url;
    }
    const callback = new URL(request.location);
    assert.equal(
      callback.origin + callback.pathname,
      redirectUri,
      `callback ${callback.pathname}`,
    );
    assert.equal(callback.searchParams.get('state'), request.state);
    assert.equal(callback.searchParams.get('iss'), issuer);
    const code = callback.searchParams.get('code');
    assert(code, `callback error ${callback.searchParams.get('error')}`);
    return { ...request, code };
  };
  const exchange = (
    request: Awaited<ReturnType<typeof issue>>,
    changes: Record<string, string | null | undefined> = {},
  ) => {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: secret,
      redirect_uri: redirectUri,
      code: request.code,
      code_verifier: request.verifier,
    });
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) body.delete(key);
      else if (value !== undefined) body.set(key, value);
    }
    return fetch(metadata.token_endpoint, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  };
  const signedOut = await begin('');
  check(
    'signed-out authorization resumes through native login with a signed query',
    new URL(signedOut.location, base).pathname === '/oauth/continue' &&
      new URL(signedOut.location, base).searchParams.has('sig'),
  );
  const initial = await begin();
  check(
    'a new client requires explicit native consent',
    new URL(initial.location, base).pathname === '/oauth/consent',
  );
  const signedQuery = new URL(initial.location, base).search.slice(1);
  check(
    'a modified signed consent query is refused',
    (
      await post(
        '/api/auth/oauth2/consent',
        {
          accept: true,
          oauth_query: `${signedQuery}&redirect_uri=https%3A%2F%2Fevil.example.test`,
        },
        member.cookie,
      )
    ).status >= 400,
  );
  const granted = await issue();
  const response = await exchange(granted);
  assert.equal(
    response.status,
    200,
    `exchange ${await response.clone().text()}`,
  );
  const tokens = z
    .object({
      id_token: z.string(),
      access_token: z.string(),
      refresh_token: z.string().optional(),
    })
    .parse(await response.json());
  const { payload } = await jwtVerify(tokens.id_token, keySet, {
    issuer,
    audience: clientId,
    algorithms: ['RS256'],
  });
  check(
    'native code exchange signs the verified email, nonce and current bound org only',
    payload.sub === member.id &&
      payload.email === member.email &&
      payload.email_verified === true &&
      payload.nonce === granted.nonce &&
      JSON.stringify(payload[OIDC_ORGANIZATION_CLAIM]) ===
        JSON.stringify({ id: org.id, slug: orgSlug, role: 'member' }) &&
      tokens.refresh_token === undefined &&
      (payload.exp ?? 0) - (payload.iat ?? 0) <= 300,
  );
  const info = await fetch(`${issuer}/oauth2/userinfo`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const infoBody = z
    .object({
      sub: z.string(),
      email_verified: z.boolean(),
      [OIDC_ORGANIZATION_CLAIM]: z.object({ id: z.string() }),
    })
    .parse(await info.json());
  check(
    'userinfo revalidates the current user and organization',
    info.ok &&
      infoBody.sub === member.id &&
      infoBody.email_verified &&
      infoBody[OIDC_ORGANIZATION_CLAIM].id === org.id,
  );
  // RFC 6750 §3: a bad or missing bearer token is 401 with a challenge —
  // every five-minute token expiry walks this path.
  const staleToken = await fetch(`${issuer}/oauth2/userinfo`, {
    headers: { Authorization: 'Bearer not-a-real-token' },
  });
  const staleBody = z
    .object({ error: z.string() })
    .parse(await staleToken.json());
  check(
    'userinfo refuses an invalid bearer token with 401 invalid_token and a Bearer challenge',
    staleToken.status === 401 &&
      staleBody.error === 'invalid_token' &&
      (staleToken.headers.get('www-authenticate') ?? '').startsWith(
        `Bearer realm="${issuer}", error="invalid_token"`,
      ),
    `status=${staleToken.status} challenge=${staleToken.headers.get('www-authenticate')} body=${JSON.stringify(staleBody)} (want 401 invalid_token, Bearer realm="${issuer}")`,
  );
  const noToken = await fetch(`${issuer}/oauth2/userinfo`);
  check(
    'userinfo without a token answers 401 with a Bearer challenge',
    noToken.status === 401 &&
      noToken.headers.get('www-authenticate') === `Bearer realm="${issuer}"`,
    `status=${noToken.status} challenge=${noToken.headers.get('www-authenticate')} (want 401, Bearer realm="${issuer}")`,
  );
  // RFC 6749 §5.2: the token endpoint speaks one error envelope, the
  // schema layer's `{message, code}` included.
  const passwordGrant = await fetch(`${issuer}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=password&username=a&password=b',
  });
  const passwordGrantBody = z
    .object({ error: z.string(), error_description: z.string() })
    .parse(await passwordGrant.json());
  check(
    'token endpoint refuses an unknown grant in the RFC 6749 envelope',
    passwordGrant.status === 400 &&
      passwordGrantBody.error === 'unsupported_grant_type',
    `status=${passwordGrant.status} body=${JSON.stringify(passwordGrantBody)} (want 400 unsupported_grant_type)`,
  );
  check(
    'an authorization code cannot be replayed',
    (await exchange(granted)).status >= 400,
  );
  const racingCode = await issue();
  const racing = await Promise.all([
    exchange(racingCode),
    exchange(racingCode),
  ]);
  check(
    'concurrent code redemption succeeds only once',
    racing.filter((r) => r.ok).length === 1 &&
      racing.filter((r) => r.status >= 400).length === 1,
  );
  for (const changes of [
    { code_verifier: null },
    { code_verifier: 'wrong-verifier' },
    { client_secret: 'wrong-secret' },
    { redirect_uri: 'https://foreign.example.test/callback' },
    { resource: 'https://foreign.example.test/api' },
    { resource: issuer },
  ]) {
    check(
      `code exchange refuses ${Object.keys(changes).join(',')} mismatch`,
      (await exchange(await issue(), changes)).status >= 400,
    );
  }
  const userinfoResource = await exchange(await issue(), {
    resource: `${issuer}/oauth2/userinfo`,
  });
  assert.equal(userinfoResource.status, 200);
  const resourceTokens = z
    .object({ access_token: z.string() })
    .parse(await userinfoResource.json());
  const { payload: resourcePayload } = await jwtVerify(
    resourceTokens.access_token,
    keySet,
    { issuer, audience: `${issuer}/oauth2/userinfo`, algorithms: ['RS256'] },
  );
  check(
    'access tokens target native userinfo only and never authenticate REST API calls',
    (Array.isArray(resourcePayload.aud)
      ? resourcePayload.aud.every((aud) => aud === `${issuer}/oauth2/userinfo`)
      : resourcePayload.aud === `${issuer}/oauth2/userinfo`) &&
      (
        await fetch(`${base}/api/v1/contacts`, {
          headers: {
            Authorization: `Bearer ${resourceTokens.access_token}`,
            'X-Organization-Slug': orgSlug,
          },
        })
      ).status === 401,
  );
  for (const changes of [
    { code_challenge: null, code_challenge_method: null },
    { code_challenge_method: 'plain' },
    { redirect_uri: 'https://foreign.example.test/callback' },
  ]) {
    const invalid = await begin(member.cookie, changes);
    check(
      `authorization refuses ${Object.keys(changes).join(',')} mismatch`,
      invalid.response.status >= 400 ||
        new URL(invalid.location, base).searchParams.has('error'),
    );
  }
  const expiring = await issue();
  // The native storage identifier is hashed. Expire only this test user's code.
  await sql`UPDATE "verification" SET "expiresAt" = ${new Date(Date.now() - 1000)} WHERE "value" LIKE ${`%${member.id}%`}`;
  check(
    'expired authorization codes cannot mint tokens',
    (await exchange(expiring)).status >= 400,
  );
  const beforeDemotion = await issue();
  await sql`UPDATE "member" SET "role" = 'disabled' WHERE "organizationId" = ${org.id} AND "userId" = ${member.id}`;
  check(
    'membership removal after authorization prevents token issuance and userinfo',
    (await exchange(beforeDemotion)).status === 403 &&
      (
        await fetch(`${issuer}/oauth2/userinfo`, {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        })
      ).status >= 400,
  );
  await sql`UPDATE "member" SET "role" = 'member' WHERE "organizationId" = ${org.id} AND "userId" = ${member.id}`;
  const beforeUnverified = await issue();
  await sql`UPDATE "user" SET "emailVerified" = false WHERE "id" = ${member.id}`;
  check(
    'unverified email cannot mint an identity',
    (await exchange(beforeUnverified)).status === 403,
  );
  const ssoArgs = {
    email: member.email.toUpperCase(),
    emailVerified: true,
    name: 'Directory profile',
    organizationId: org.id,
    externalId: `oidc-entra-${suffix}`,
    providerId: 'entra-id',
    accessToken: 'isolated-test-token',
    role: 'member' as const,
  };
  const linked = await findOrCreateSsoUser(sql, ssoArgs);
  const linkedAgain = await findOrCreateSsoUser(sql, ssoArgs);
  const verifiedUser = await sql<
    { emailVerified: boolean; name: string }[]
  >`SELECT "emailVerified", "name" FROM "user" WHERE "id" = ${member.id}`;
  const providerAccounts = await sql<
    { count: string }[]
  >`SELECT count(*)::text AS count FROM "account" WHERE "userId" = ${member.id} AND "providerId" = 'entra-id'`;
  check(
    'trusted SSO verifies an existing member without duplicating or renaming its account',
    linked.userId === member.id &&
      linkedAgain.userId === member.id &&
      verifiedUser[0]?.emailVerified &&
      verifiedUser[0]?.name === 'Identity member' &&
      providerAccounts[0]?.count === '1',
  );
  const changedSubject = await findOrCreateSsoUser(sql, {
    ...ssoArgs,
    externalId: 'changed-subject',
  });
  const changedEmail = await findOrCreateSsoUser(sql, {
    ...ssoArgs,
    email: owner.email,
  });
  check(
    'a verified directory email cannot rebind an immutable subject or another account',
    changedSubject.userId === null && changedEmail.userId === null,
  );
  const factorCode = await issue();
  const governance = path.join(
    process.env.TALE_CONFIG_DIR ?? '',
    orgSlug,
    'governance',
  );
  await mkdir(governance, { recursive: true });
  await writeFile(
    path.join(governance, 'two-factor-policy.yml'),
    'enforced: true\ngracePeriodDays: 0\nexemptSsoUsers: false\n',
  );
  clearOrgConfigCaches();
  check(
    'native MFA enrollment enforcement also withholds OAuth authority',
    (await exchange(factorCode)).status === 403,
  );
  await writeFile(
    path.join(governance, 'two-factor-policy.yml'),
    'enforced: false\ngracePeriodDays: 0\nexemptSsoUsers: false\n',
  );
  clearOrgConfigCaches();
  const rotatePath = `/api/app/identity/clients/vatplus/rotate-secret?orgId=${org.id}`;
  check(
    'ordinary members cannot rotate the integration secret',
    (await post(rotatePath, {}, member.cookie)).status === 403,
  );
  const rotation = await post(rotatePath, {}, owner.cookie);
  assert.equal(rotation.status, 200);
  const rotated = z
    .object({ client_secret: z.string() })
    .parse(await rotation.json());
  check(
    'rotation returns a fresh secret once',
    rotated.client_secret !== secret,
  );
  check(
    'the retired client secret cannot exchange a newly issued code',
    (await exchange(await issue())).status >= 400,
  );
  secret = rotated.client_secret;
  check(
    'the new secret exchanges codes for the same stable client ID',
    (await exchange(await issue())).ok,
  );
  const statusPath = `/api/app/identity/clients/vatplus/status?orgId=${org.id}`;
  assert.equal(
    (await post(statusPath, { disabled: true }, owner.cookie)).status,
    200,
  );
  const disabled = await begin();
  check(
    'disabling a client prevents new authorizations',
    disabled.response.status >= 400 ||
      new URL(disabled.location, base).searchParams.has('error'),
  );
  assert.equal(
    (await post(statusPath, { disabled: false }, owner.cookie)).status,
    200,
  );
  check(
    'reenabling the same client restores the reviewed configuration',
    (await exchange(await issue())).ok,
  );
  // Confirm the provider is part of this exact app/auth instance, not a fake issuer.
  check(
    'the native provider is installed',
    auth.options.plugins.some((plugin) => plugin.id === 'oauth-provider'),
  );
  await sql.begin((tx) =>
    deleteOrganization(tx, { userId: owner.id, email: owner.email }, org.id),
  );
  const clientsAfterRetirement =
    await sql`SELECT "id" FROM "oauthClient" WHERE "clientId" = ${clientId}`;
  const consentsAfterRetirement =
    await sql`SELECT "id" FROM "oauthConsent" WHERE "clientId" = ${clientId}`;
  check(
    'organization retirement removes its native clients and consent grants',
    clientsAfterRetirement.length === 0 && consentsAfterRetirement.length === 0,
  );
}
