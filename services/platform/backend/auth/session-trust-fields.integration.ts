/**
 * Real-Postgres proof that the session's trusted-headers fields are the
 * server's alone. `trustedRole` and `trustedOrganizationId` carry the role
 * an authenticating proxy asserted at sign-in, and the org gate applies that
 * role in that one organization (`auth/org.ts`). No request body writes
 * them, and the gate honours a trusted role only while the organization
 * lets a proxy assert it.
 */
import type { Sql } from 'postgres';

export async function checkSessionTrustFieldsAreServerOnly(
  sql: Sql,
  base: string,
  ctx: { orgId: string },
  // A plain member of the organization, signed in with a password.
  member: { cookie: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const attempt = await fetch(`${base}/api/auth/update-session`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: base,
      cookie: member.cookie,
    },
    body: JSON.stringify({
      trustedRole: 'owner',
      trustedOrganizationId: ctx.orgId,
    }),
  });
  const stored = await sql<
    { trustedRole: string | null; trustedOrganizationId: string | null }[]
  >`
    SELECT "trustedRole", "trustedOrganizationId" FROM "session"
    WHERE "userId" = ${member.userId}
  `;
  // An admin-only read: the member must still be refused.
  const adminRead = await fetch(
    `${base}/api/app/audit-logs?orgId=${encodeURIComponent(ctx.orgId)}`,
    { headers: { cookie: member.cookie } },
  );
  // A row carrying a role no proxy could assert counts for nothing: the gate
  // applies a trusted role only while the organization lets a proxy assert
  // it, and nobody may assert owner.
  await sql`
    UPDATE "session" SET "trustedRole" = 'owner',
      "trustedOrganizationId" = ${ctx.orgId}
    WHERE "userId" = ${member.userId}
  `;
  const forgedRead = await fetch(
    `${base}/api/app/audit-logs?orgId=${encodeURIComponent(ctx.orgId)}`,
    { headers: { cookie: member.cookie } },
  );
  await sql`
    UPDATE "session" SET "trustedRole" = NULL, "trustedOrganizationId" = NULL
    WHERE "userId" = ${member.userId}
  `;
  // Boot signed out, once, every session that carried a trusted role.
  const repaired = await sql<{ name: string }[]>`
    SELECT name FROM app.boot_repairs
    WHERE name = 'revoke-client-written-trust-fields'
  `;
  record(
    'auth: a trusted role no proxy could assert grants nothing, and boot reset such sessions once',
    forgedRead.status === 403 && repaired.length === 1,
    `owner in the session row → admin-only read ${forgedRead.status} (want 403), boot repair recorded=${repaired.length} (want 1)`,
  );
  record(
    "auth: a member cannot write the session's trusted role or organization",
    attempt.status >= 400 &&
      stored.length > 0 &&
      stored.every(
        (row) => row.trustedRole === null && row.trustedOrganizationId === null,
      ) &&
      adminRead.status === 403,
    `update-session → ${attempt.status} (want 4xx), stored=${JSON.stringify(stored)}, admin-only read → ${adminRead.status} (want 403)`,
  );
}
