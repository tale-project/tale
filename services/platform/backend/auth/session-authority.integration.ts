/** Real factory/app HTTP proof. A dedicated multi-org Owner retains every
 * seat while an actual org-minted session is confined to its source realm,
 * makes its own API key bound to that realm, and stays its person's to sign
 * out of; so does a sign-in with a passkey enrolled behind a proxy, which
 * keeps the proxy's role as its ceiling. Cutover inventory/WebAuthn are
 * exercised in their isolated PG fixture. */
import { createHash, randomUUID } from 'node:crypto';

import { generateId } from 'better-auth';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { isProxiedSession } from '../../lib/shared/proxied-session.ts';
import { buildSessionCookie } from '../core/enterprise_sso/login/finish_login.ts';
import { createSsoUserSession } from '../domains/sso/service.ts';
import {
  cookieHeaderFrom,
  ITEST_PASSWORD,
} from '../integration-lane-helpers.ts';
import type { Auth } from './auth.ts';
import { createPasskeyAuthority } from './passkey-authority.ts';
import { orgSessionCutoverAt } from './session-authority.ts';

export async function checkOrganizationSessionAuthority(
  sql: Sql,
  base: string,
  auth: Auth,
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const post = (route: string, body: object, cookie = '') =>
    fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base, cookie },
      body: JSON.stringify(body),
      redirect: 'manual',
    });
  const signup = await post('/api/auth/sign-up/email', {
    name: 'Authority fixture',
    email: `authority-${suffix}@example.test`,
    password: ITEST_PASSWORD,
  });
  if (signup.status !== 200)
    throw new Error('Authority fixture account creation was refused');
  const userId = z
    .object({ user: z.object({ id: z.string() }) })
    .parse(await signup.json()).user.id;
  const globalCookie = cookieHeaderFrom(signup);
  const organizations: string[] = [];
  for (const label of ['a', 'b']) {
    const response = await post(
      '/api/auth/organization/create',
      {
        name: `Authority ${label}`,
        slug: `authority-${label}-${suffix}`,
      },
      globalCookie,
    );
    if (response.status !== 200)
      throw new Error('Authority fixture organization creation was refused');
    organizations.push(
      z.object({ id: z.string() }).parse(await response.json()).id,
    );
  }
  const [orgA, orgB] = organizations;
  if (orgA === undefined || orgB === undefined)
    throw new Error('Authority fixture organizations were missing');
  const seats = () => sql<{ organizationId: string; role: string }[]>`
    SELECT "organizationId", "role" FROM "member" WHERE "userId" = ${userId} ORDER BY "organizationId"
  `;
  const before = await seats();
  const minted = await createSsoUserSession(sql, {
    userId,
    organizationId: orgA,
  });
  const cookieOf = async (sessionToken: string) =>
    (
      await buildSessionCookie(sessionToken, base, auth.options.secret ?? '')
    ).split(';')[0] ?? '';
  const scopedCookie = await cookieOf(minted.sessionToken);
  const readOrg = (orgId: string, cookie: string) =>
    fetch(`${base}/api/app/organizations/${encodeURIComponent(orgId)}`, {
      headers: { cookie },
    });
  const own = await readOrg(orgA, scopedCookie);
  const foreign = await readOrg(orgB, scopedCookie);
  const global = await readOrg(orgB, globalCookie);
  record(
    'auth authority: an org-minted cookie keeps its realm and all legitimate Owner seats',
    own.status === 200 &&
      foreign.status === 403 &&
      global.status === 200 &&
      before.length === 2 &&
      before.every((seat) => seat.role === 'owner') &&
      JSON.stringify(await seats()) === JSON.stringify(before),
    `own=${own.status}, foreign=${foreign.status}, independent=${global.status}; memberships preserved`,
  );
  const spoofed = await post(
    '/api/auth/update-user',
    {
      name: 'Client proof',
      trustedOrganizationId: null,
      independentIdentityVerifiedAt: new Date().toISOString(),
    },
    scopedCookie,
  );
  const heldEnrollment = await fetch(
    `${base}/api/auth/passkey/generate-register-options`,
    {
      headers: { cookie: scopedCookie },
    },
  );
  record(
    'auth authority: client proof cannot authorize account changes and org enrollment waits for cutover',
    spoofed.status === 403 && heldEnrollment.status === 403,
    `account=${spoofed.status}, held enrollment=${heldEnrollment.status}`,
  );
  const confirmation = await post(
    '/api/auth/reauthenticate',
    { password: ITEST_PASSWORD },
    scopedCookie,
  );
  const confirmedCookie = cookieHeaderFrom(confirmation);
  const confirmedForeign = await readOrg(orgB, confirmedCookie);
  const key = await post(
    '/api/auth/api-key/create',
    { name: 'Unbound authority fixture' },
    confirmedCookie,
  );
  const account = await post(
    '/api/auth/update-user',
    { name: 'Confirmed fixture' },
    confirmedCookie,
  );
  const rows = await sql<{ realm: string | null; proved: boolean }[]>`
    SELECT "trustedOrganizationId" AS realm, ("independentIdentityVerifiedAt" IS NOT NULL) AS proved
    FROM "session" WHERE "userId" = ${userId} AND "trustedOrganizationId" = ${orgA}
  `;
  record(
    'auth authority: a genuine password rotation proves narrow account actions without unbound authority',
    confirmation.status === 200 &&
      confirmedForeign.status === 403 &&
      key.status === 403 &&
      account.status === 200 &&
      rows.length === 1 &&
      rows[0]?.realm === orgA &&
      rows[0].proved &&
      JSON.stringify(await seats()) === JSON.stringify(before),
    `confirmation=${confirmation.status}, account=${account.status}, foreign=${confirmedForeign.status}, key=${key.status}; scope and seats preserved`,
  );

  // A single sign-on session makes its person's own key at its
  // organization's door, bound there (APIKEY-R13): it acts as them in that
  // organization alone, they see it and end it there, nobody is notified,
  // and the personal-key door still refuses them a key that works in every
  // organization. A password session's own key stays a personal one.
  const ownSession = await createSsoUserSession(sql, {
    userId,
    organizationId: orgA,
  });
  const ownCookie = await cookieOf(ownSession.sessionToken);
  const keyDoor = `/api/app/api-keys?orgId=${encodeURIComponent(orgA)}`;
  const ownKey = await post(
    keyDoor,
    { name: `Own ${suffix}`, owner: { kind: 'self' } },
    ownCookie,
  );
  const ownMinted = z
    .object({ id: z.string(), key: z.string() })
    .safeParse(await ownKey.json().catch(() => null));
  const ownId = ownMinted.success ? ownMinted.data.id : '';
  const ownSecret = ownMinted.success ? ownMinted.data.key : '';
  const unboundOwn = await post(
    '/api/auth/api-key/create',
    { name: `Unbound own ${suffix}` },
    ownCookie,
  );
  const unboundCode = z
    .looseObject({ code: z.string().optional() })
    .safeParse(await unboundOwn.json().catch(() => null));
  const fromPassword = await post(
    keyDoor,
    { name: `Password own ${suffix}`, owner: { kind: 'self' } },
    globalCookie,
  );
  const fromPasswordCode = z
    .looseObject({ error: z.string().optional() })
    .safeParse(await fromPassword.json().catch(() => null));
  const ownBinding = await sql<
    { kind: string; principal: string; maker: string }[]
  >`
    SELECT owner_kind AS kind, principal_user_id AS principal,
           created_by AS maker
    FROM app.api_key_owners WHERE api_key_id = ${ownId}
  `;
  const meWith = (headers: Record<string, string> = {}) =>
    fetch(`${base}/api/v1/me`, {
      headers: { authorization: `Bearer ${ownSecret}`, ...headers },
    });
  const ownMe = await meWith();
  const ownMeBody = z
    .looseObject({
      user: z.looseObject({ id: z.string() }),
      organizations: z.array(z.looseObject({ id: z.string() })),
      key: z.looseObject({ owner: z.looseObject({ kind: z.string() }) }),
    })
    .safeParse(await ownMe.json().catch(() => null));
  const ownElsewhere = await meWith({
    'x-organization-slug': `authority-b-${suffix}`,
  });
  const ownListed = z
    .object({
      keys: z.array(z.looseObject({ id: z.string(), canRevoke: z.boolean() })),
    })
    .safeParse(
      await (
        await fetch(`${base}${keyDoor}`, { headers: { cookie: ownCookie } })
      )
        .json()
        .catch(() => null),
    );
  const ownRow = ownListed.success
    ? ownListed.data.keys.find((listed) => listed.id === ownId)
    : undefined;
  const ownNotices = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM app.user_notifications
    WHERE user_id = ${userId} AND org_id = ${orgA}
      AND type = 'api_key_created'
  `;
  const ownEnded = await fetch(
    `${base}/api/app/api-keys/${encodeURIComponent(ownId)}?orgId=${encodeURIComponent(orgA)}`,
    { method: 'DELETE', headers: { cookie: ownCookie, origin: base } },
  );
  const ownAfter = await meWith();
  record(
    'auth authority: a single sign-on session makes its own key bound to its organization, and ends it there',
    ownKey.status === 201 &&
      ownBinding[0]?.kind === 'member' &&
      ownBinding[0].principal === userId &&
      ownBinding[0].maker === userId &&
      ownMe.status === 200 &&
      ownMeBody.success &&
      ownMeBody.data.user.id === userId &&
      ownMeBody.data.organizations.length === 1 &&
      ownMeBody.data.organizations[0]?.id === orgA &&
      ownMeBody.data.key.owner.kind === 'member' &&
      ownElsewhere.status === 403 &&
      ownRow?.canRevoke === true &&
      ownNotices[0]?.count === 0 &&
      ownEnded.status === 200 &&
      ownAfter.status === 401 &&
      unboundOwn.status === 403 &&
      unboundCode.success &&
      unboundCode.data.code === 'ORG_FORBIDDEN' &&
      fromPassword.status === 400 &&
      fromPasswordCode.success &&
      fromPasswordCode.data.error === 'API_KEY_MEMBER_SELF',
    `create=${ownKey.status} (want 201), binding=${JSON.stringify(ownBinding[0] ?? null)} (want member/${userId}/${userId}), me=${ownMe.status} orgs=${ownMeBody.success ? ownMeBody.data.organizations.length : '?'} owner=${ownMeBody.success ? ownMeBody.data.key.owner.kind : '?'}, elsewhere=${ownElsewhere.status} (want 403), listed=${JSON.stringify(ownRow ?? null)}, notices=${ownNotices[0]?.count ?? '?'} (want 0), end=${ownEnded.status} after=${ownAfter.status} (want 200/401), unbound=${unboundOwn.status}/${unboundCode.success ? unboundCode.data.code : '?'} (want 403/ORG_FORBIDDEN), password=${fromPassword.status}/${fromPasswordCode.success ? fromPasswordCode.data.error : '?'} (want 400/API_KEY_MEMBER_SELF)`,
  );

  // A single sign-on session is bound to its organization like the one
  // above, but names no role: the app reads it back as its person's, so it
  // offers Log out, and signing out ends it (#5137). The trusted-headers
  // door's session reads as the proxy's (`checkTrustedHeaders`).
  const signedIn = await createSsoUserSession(sql, {
    userId,
    organizationId: orgA,
  });
  const signedInCookie = await cookieOf(signedIn.sessionToken);
  const readSession = async (cookie: string): Promise<unknown> =>
    (
      await fetch(`${base}/api/auth/get-session`, {
        headers: { cookie, origin: base },
      })
    ).json();
  const read = z
    .object({
      session: z.looseObject({ trustedOrganizationId: z.string().nullish() }),
    })
    .safeParse(await readSession(signedInCookie));
  const bound =
    read.success && read.data.session.trustedOrganizationId === orgA;
  const proxied = read.success && isProxiedSession(read.data.session);
  const signOut = await post('/api/auth/sign-out', {}, signedInCookie);
  const left = await sql`
    SELECT "id" FROM "session" WHERE "token" = ${signedIn.sessionToken}
  `;
  const afterSignOut = await readSession(signedInCookie);
  record(
    "auth authority: a single sign-on session is its person's to sign out of",
    bound &&
      !proxied &&
      signOut.status === 200 &&
      left.length === 0 &&
      afterSignOut === null,
    `bound=${bound}, proxied=${proxied} (want false), sign-out=${signOut.status} (want 200), rows left=${left.length} (want 0), after=${JSON.stringify(afterSignOut)} (want null)`,
  );

  // A passkey enrolled behind a proxy keeps the role the proxy asserted as
  // its ceiling, and each sign-in with it names that role again
  // (`passkey-authority.ts`). Its person signed in on Tale's own form, so
  // the session reads as theirs, and signing out ends it (#5259); the
  // trusted-headers door's session still reads as the proxy's
  // (`checkTrustedHeaders`). WebAuthn cannot be driven from a script: the
  // ceremony's own callback and the production session-create hook write
  // the row such a sign-in writes, from the passkey's stored authority.
  const credentialID = `authority-passkey-${suffix}`;
  const passkeyId = randomUUID();
  await sql`
    INSERT INTO "passkey" (id, "userId", name, "publicKey", "credentialID",
                           counter, "deviceType", "backedUp", "createdAt")
    VALUES (${passkeyId}, ${userId}, 'Proxy-enrolled device', 'fixture-public-key',
            ${credentialID}, 0, 'singleDevice', false, ${new Date()})
  `;
  await sql`
    INSERT INTO app.auth_factor_authorities (
      credential_fingerprint, credential_id, user_id, org_id, trusted_role, authority, state
    ) VALUES (${createHash('sha256').update(credentialID).digest('hex')}, ${passkeyId},
      ${userId}, ${orgA}, 'member', 'organization', 'bound')
  `;
  const ceremonyPath = '/passkey/verify-authentication';
  const ceremony = {
    path: ceremonyPath,
    request: new Request(`${base}/api/auth${ceremonyPath}`, {
      method: 'POST',
    }),
    context: {},
  };
  const verified = createPasskeyAuthority(sql, orgSessionCutoverAt()).options
    .authentication?.afterVerification;
  const createSession = auth.options.databaseHooks?.session?.create?.before;
  if (verified === undefined || createSession === undefined)
    throw new Error(
      'The passkey ceremony or the session-create hook was missing',
    );
  // Both read only the request and the path of Better Auth's endpoint
  // context, and the ceremony only the public handle of the client's answer.
  await verified(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the ceremony reads only the request and the public handle (`passkey-authority.ts`)
    {
      ctx: ceremony,
      verification: { verified: true },
      clientData: { id: credentialID },
    } as Parameters<NonNullable<typeof verified>>[0],
  );
  const passkeyToken = generateId(32);
  const mintedAt = new Date();
  const hooked: unknown = await createSession(
    {
      id: randomUUID(),
      ipAddress: '',
      userAgent: '',
      expiresAt: new Date(mintedAt.getTime() + 60 * 60 * 1000),
      userId,
      token: passkeyToken,
      createdAt: mintedAt,
      updatedAt: mintedAt,
    },
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the create hook reads only the request and the path (`auth.ts`)
    ceremony as Parameters<NonNullable<typeof createSession>>[1],
  );
  await (
    await auth.$context
  ).adapter.create({
    model: 'session',
    data: z.object({ data: z.looseObject({}) }).parse(hooked).data,
    forceAllowId: true,
  });
  const passkeyCookie = await cookieOf(passkeyToken);
  const passkeyRead = z
    .object({
      session: z.looseObject({
        trustedOrganizationId: z.string().nullish(),
        trustedRole: z.string().nullish(),
      }),
    })
    .safeParse(await readSession(passkeyCookie));
  const ceiling =
    passkeyRead.success &&
    passkeyRead.data.session.trustedOrganizationId === orgA &&
    passkeyRead.data.session.trustedRole === 'member';
  const passkeyProxied =
    passkeyRead.success && isProxiedSession(passkeyRead.data.session);
  const passkeyForeign = await readOrg(orgB, passkeyCookie);
  const passkeySignOut = await post('/api/auth/sign-out', {}, passkeyCookie);
  const passkeyLeft = await sql`
    SELECT "id" FROM "session" WHERE "token" = ${passkeyToken}
  `;
  const afterPasskey = await readSession(passkeyCookie);
  record(
    "auth authority: a passkey enrolled behind a proxy keeps its ceiling, and its sign-in is its person's to sign out of",
    ceiling &&
      !passkeyProxied &&
      passkeyForeign.status === 403 &&
      passkeySignOut.status === 200 &&
      passkeyLeft.length === 0 &&
      afterPasskey === null,
    `ceiling=${ceiling} (want ${orgA}/member), proxied=${passkeyProxied} (want false), foreign=${passkeyForeign.status} (want 403), sign-out=${passkeySignOut.status} (want 200), rows left=${passkeyLeft.length} (want 0), after=${JSON.stringify(afterPasskey)} (want null)`,
  );
}
