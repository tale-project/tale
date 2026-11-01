/** Real factory/app HTTP proof. A dedicated multi-org Owner retains every
 * seat while an actual org-minted session is confined to its source realm,
 * and stays its person's to sign out of.
 * Cutover inventory/WebAuthn are exercised in their isolated PG fixture. */
import { randomUUID } from 'node:crypto';

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
}
