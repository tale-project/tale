import { randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import {
  cookieHeaderFrom,
  ITEST_PASSWORD,
  type RecordCheck,
} from '../../integration-lane-helpers.ts';
import {
  listPasskeysForMember,
  MemberServiceError,
  resetTwoFactorForMember,
  revokePasskeyForMember,
} from './service.ts';

/** Global factors use the real membership readers and writers, with each
 * operation witnessed before and after on a fresh, lane-owned account. */
export async function checkMemberAccountAuthority(
  sql: Sql,
  auth: Auth,
  base: string,
  record: RecordCheck,
): Promise<void> {
  const seed = async (actorB: string | null, targetB: string | null) => {
    const prefix = `itest-member-authority-${randomUUID()}`;
    const actor = `${prefix}-actor`;
    const target = `${prefix}-target`;
    const orgA = `${prefix}-a`;
    const orgB = `${prefix}-b`;
    const memberId = `${prefix}-member`;
    const passkeyId = `${prefix}-passkey`;
    const now = new Date();
    await sql.begin(async (tx) => {
      for (const id of [orgA, orgB]) {
        await tx`
          INSERT INTO "organization" (id, name, slug, "createdAt")
          VALUES (${id}, 'Member authority fixture', ${id}, ${now})
        `;
      }
      for (const id of [actor, target]) {
        await tx`
          INSERT INTO "user" (id, name, email, "emailVerified", "createdAt",
                              "updatedAt", "twoFactorEnabled")
          VALUES (${id}, 'Member authority fixture', ${`${id}@example.com`},
                  true, ${now}, ${now}, ${id === target})
        `;
      }
      for (const seat of [
        { id: `${prefix}-actor-a`, user: actor, org: orgA, role: 'admin' },
        { id: memberId, user: target, org: orgA, role: 'member' },
        ...(actorB === null
          ? []
          : [
              { id: `${prefix}-actor-b`, user: actor, org: orgB, role: actorB },
            ]),
        ...(targetB === null
          ? []
          : [
              {
                id: `${prefix}-target-b`,
                user: target,
                org: orgB,
                role: targetB,
              },
            ]),
      ]) {
        await tx`
          INSERT INTO "member" (id, "userId", "organizationId", role, "createdAt")
          VALUES (${seat.id}, ${seat.user}, ${seat.org}, ${seat.role}, ${now})
        `;
      }
      await tx`
        INSERT INTO "passkey" (id, "userId", name, "publicKey", "credentialID",
                               counter, "deviceType", "backedUp", "createdAt")
        VALUES (${passkeyId}, ${target}, 'Fixture device', 'fixture-public-key',
                ${passkeyId}, 0, 'singleDevice', false, ${now})
      `;
      await tx`
        INSERT INTO "twoFactor" (id, "userId", secret, "backupCodes")
        VALUES (${`${prefix}-totp`}, ${target}, 'fixture-secret', 'fixture-codes')
      `;
      for (const suffix of ['one', 'two']) {
        await tx`
          INSERT INTO "session" (id, "userId", token, "createdAt", "updatedAt", "expiresAt")
          VALUES (${`${prefix}-${suffix}`}, ${target}, ${randomUUID()},
                  ${now}, ${now}, ${new Date(now.getTime() + 3_600_000)})
        `;
      }
      await tx`
        INSERT INTO app.two_factor_grace (user_id, grace_until_ms)
        VALUES (${target}, ${Date.now() + 3_600_000})
      `;
      await tx`
        INSERT INTO app.two_factor_attempts (user_id, consecutive_failures, last_failure_at_ms)
        VALUES (${target}, 3, ${Date.now()})
      `;
    });
    return { actor, target, orgA, orgB, memberId, passkeyId };
  };
  const snapshot = async (target: string) => {
    const state: Record<string, unknown> = {};
    for (const [table, column] of [
      ['user', 'id'],
      ['passkey', 'userId'],
      ['twoFactor', 'userId'],
      ['session', 'userId'],
      ['app.two_factor_grace', 'user_id'],
      ['app.two_factor_attempts', 'user_id'],
      ['app.audit_logs', 'resource_id'],
    ]) {
      if (table === undefined || column === undefined) continue;
      const rows = await sql<{ data: Record<string, unknown> }[]>`
        SELECT to_jsonb(t) AS data FROM ${sql(table)} t
        WHERE ${sql(column)} = ${target} ORDER BY to_jsonb(t)::text
      `;
      state[table] = rows.map((row) => row.data);
    }
    return JSON.stringify(state);
  };
  const cases = [
    { name: 'one workspace', actorB: null, targetB: null, allowed: true },
    {
      name: 'admin in both workspaces',
      actorB: 'admin',
      targetB: 'member',
      allowed: true,
    },
    {
      name: 'another workspace without authority',
      actorB: null,
      targetB: 'member',
      allowed: false,
    },
    {
      name: 'a disabled target seat elsewhere',
      actorB: null,
      targetB: 'disabled',
      allowed: false,
    },
    {
      name: 'a disabled caller seat elsewhere',
      actorB: 'disabled',
      targetB: 'member',
      allowed: false,
    },
    {
      name: 'another workspace owner',
      actorB: 'admin',
      targetB: 'owner',
      allowed: false,
      listAllowed: true,
    },
    {
      name: 'a different owner in the other workspace',
      actorB: 'owner',
      targetB: 'owner',
      allowed: true,
    },
  ];
  for (const scenario of cases) {
    for (const action of ['list', 'reset', 'revoke'] as const) {
      const fixture = await seed(scenario.actorB, scenario.targetB);
      const before = await snapshot(fixture.target);
      let code = '';
      let listed = 0;
      try {
        if (action === 'list') {
          listed = (
            await listPasskeysForMember(
              sql,
              { userId: fixture.actor },
              fixture.memberId,
            )
          ).length;
        } else {
          await transactSerializable(sql, (tx) =>
            action === 'reset'
              ? resetTwoFactorForMember(
                  tx,
                  { userId: fixture.actor },
                  fixture.memberId,
                )
              : revokePasskeyForMember(
                  tx,
                  { userId: fixture.actor },
                  { memberId: fixture.memberId, passkeyId: fixture.passkeyId },
                ),
          );
        }
      } catch (error) {
        if (!(error instanceof MemberServiceError)) throw error;
        code = `${error.status}/${error.code}`;
      }
      const after = await snapshot(fixture.target);
      const allowed =
        action === 'list' && scenario.listAllowed === true
          ? true
          : scenario.allowed;
      const audits = await sql<
        {
          action: string;
          category: string;
          status: string;
          actor: string;
          role: string | null;
        }[]
      >`
        SELECT action, category, status, actor_id AS actor, actor_role AS role
        FROM app.audit_logs WHERE resource_id = ${fixture.target}
      `;
      const sessions = await sql<
        { count: string }[]
      >`SELECT count(*)::text AS count FROM "session" WHERE "userId" = ${fixture.target}`;
      const factors = await sql<
        {
          passkeys: string;
          totp: string;
          enabled: boolean;
          grace: string;
          attempts: string;
        }[]
      >`
        SELECT (SELECT count(*) FROM "passkey" WHERE "userId" = ${fixture.target})::text AS passkeys,
               (SELECT count(*) FROM "twoFactor" WHERE "userId" = ${fixture.target})::text AS totp,
               "twoFactorEnabled" AS enabled,
               (SELECT count(*) FROM app.two_factor_grace WHERE user_id = ${fixture.target})::text AS grace,
               (SELECT count(*) FROM app.two_factor_attempts WHERE user_id = ${fixture.target})::text AS attempts
        FROM "user" WHERE id = ${fixture.target}
      `;
      const factor = factors[0];
      const writesCorrect =
        action === 'list'
          ? listed === 1 && before === after && audits.length === 0
          : sessions[0]?.count === '0' &&
            audits.length === 1 &&
            audits[0]?.actor === fixture.actor &&
            audits[0]?.role === 'admin' &&
            audits[0]?.category === 'auth' &&
            audits[0]?.status === 'success' &&
            (action === 'reset'
              ? audits[0]?.action === '2fa_reset_by_admin' &&
                factor?.passkeys === '1' &&
                factor.totp === '0' &&
                !factor.enabled &&
                factor.grace === '0' &&
                factor.attempts === '0'
              : audits[0]?.action === 'passkey.revoked_by_admin' &&
                factor?.passkeys === '0' &&
                factor.totp === '1' &&
                factor.enabled &&
                factor.grace === '1' &&
                factor.attempts === '1');
      record(
        `member account authority: ${action}, ${scenario.name} [MEMBER-R6] [MEMBER-R7] [MEMBER-R8]`,
        allowed
          ? code === '' && writesCorrect
          : code === '403/FORBIDDEN' && before === after,
        `allowed=${allowed}, code=${code || 'success'}, unchanged=${before === after}, sessions=${sessions[0]?.count}, audits=${audits.length}, callerRole=${audits[0]?.role ?? 'none'}`,
      );
    }
  }

  const rightful = await seed('admin', 'member');
  const foreign = await seed(null, null);
  const rightfulBefore = await snapshot(rightful.target);
  const foreignBefore = await snapshot(foreign.target);
  let foreignCode = '';
  try {
    await transactSerializable(sql, (tx) =>
      revokePasskeyForMember(
        tx,
        { userId: rightful.actor },
        { memberId: rightful.memberId, passkeyId: foreign.passkeyId },
      ),
    );
  } catch (error) {
    if (!(error instanceof MemberServiceError)) throw error;
    foreignCode = `${error.status}/${error.code}`;
  }
  record(
    'member account authority: a foreign passkey changes neither account [MEMBER-R8]',
    foreignCode === '404/PASSKEY_NOT_FOUND' &&
      rightfulBefore === (await snapshot(rightful.target)) &&
      foreignBefore === (await snapshot(foreign.target)),
    `code=${foreignCode}, rightful and foreign account state compared`,
  );

  const handlerId = `itest-member-http-${randomUUID()}`;
  const signup = await auth.handler(
    new Request(`${base}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({
        name: 'Member boundary fixture',
        email: `${handlerId}@example.com`,
        password: ITEST_PASSWORD,
      }),
    }),
  );
  const identity = z
    .object({ user: z.object({ id: z.string() }) })
    .parse(await signup.json());
  const cookie = cookieHeaderFrom(signup);
  if (signup.status !== 200 || !cookie)
    throw new Error('Fixture sign-up did not create a real session');
  const actorMember = `${handlerId}-actor`;
  await sql`INSERT INTO "organization" (id, name, slug, "createdAt") VALUES (${handlerId}, 'Member HTTP fixture', ${handlerId}, ${new Date()})`;
  await sql`INSERT INTO "member" (id, "userId", "organizationId", role, "createdAt") VALUES (${actorMember}, ${identity.user.id}, ${handlerId}, 'admin', ${new Date()})`;
  const memberRows = () =>
    sql`SELECT to_jsonb(m)::text AS row FROM "member" m WHERE "organizationId" = ${handlerId} ORDER BY id`;
  for (const [path, body] of [
    [
      '/organization/update-member-role',
      { organizationId: handlerId, memberId: actorMember, role: 'member' },
    ],
    [
      '/organization/remove-member',
      { organizationId: handlerId, memberIdOrEmail: actorMember },
    ],
  ] as const) {
    // Independent fixture setup: old role mutation must not remove the
    // authority needed for the old removal probe to reach its own writer.
    await sql`UPDATE "member" SET role = 'admin' WHERE id = ${actorMember}`;
    const before = await memberRows();
    const response = await auth.handler(
      new Request(`${base}/api/auth${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: base, cookie },
        body: JSON.stringify(body),
      }),
    );
    const after = await memberRows();
    record(
      `member account authority: authenticated HTTP ${path} is closed without a write [MEMBER-R10]`,
      response.status === 404 &&
        before.length === 1 &&
        JSON.stringify(before) === JSON.stringify(after),
      `status=${response.status}, before=${before.length}, after=${after.length}, unchanged=${JSON.stringify(before) === JSON.stringify(after)}`,
    );
  }

  const trusted = await seed(null, null);
  const team = `${trusted.target}-team`;
  await sql`INSERT INTO "member" (id, "userId", "organizationId", role, "createdAt") VALUES (${`${trusted.target}-caller`}, ${identity.user.id}, ${trusted.orgA}, 'admin', ${new Date()})`;
  await sql`INSERT INTO "team" (id, name, "organizationId", "createdAt") VALUES (${team}, 'Trusted cleanup fixture', ${trusted.orgA}, ${new Date()})`;
  await sql`INSERT INTO "teamMember" (id, "teamId", "userId", "createdAt") VALUES (${`${team}-seat`}, ${team}, ${trusted.target}, ${new Date()})`;
  await sql`INSERT INTO app.user_preferences (org_id, user_id, updated_at) VALUES (${trusted.orgA}, ${trusted.target}, ${Date.now()})`;
  for (const competence of ['tale:rest.act-as', 'Fixture qualification']) {
    await sql`
      INSERT INTO app.competence_records (org_id, user_id, competence, granted_by, granted_at_ms)
      VALUES (${trusted.orgA}, ${trusted.target}, ${competence}, ${identity.user.id}, ${Date.now()})
    `;
  }
  await auth.api.removeMember({
    headers: new Headers({ cookie }),
    body: { organizationId: trusted.orgA, memberIdOrEmail: trusted.memberId },
  });
  const cascade = await sql<
    {
      member: string;
      team: string;
      preferences: string;
      revoked: string;
      jobs: string;
    }[]
  >`
    SELECT (SELECT count(*) FROM "member" WHERE id = ${trusted.memberId})::text AS member,
           (SELECT count(*) FROM "teamMember" WHERE "teamId" = ${team} AND "userId" = ${trusted.target})::text AS team,
           (SELECT count(*) FROM app.user_preferences WHERE org_id = ${trusted.orgA} AND user_id = ${trusted.target})::text AS preferences,
           (SELECT count(*) FROM app.competence_records WHERE org_id = ${trusted.orgA} AND user_id = ${trusted.target} AND revoked_at_ms IS NOT NULL)::text AS revoked,
           (SELECT count(*) FROM pgboss.job WHERE data->>'organizationId' = ${trusted.orgA} AND data->>'userId' = ${trusted.target} AND data->>'reason' = 'member_removed')::text AS jobs
  `;
  record(
    'member account authority: trusted server removal retains the real SQL cascade',
    cascade[0]?.member === '0' &&
      cascade[0].team === '0' &&
      cascade[0].preferences === '0' &&
      cascade[0].revoked === '2' &&
      cascade[0].jobs === '1',
    `member=${cascade[0]?.member}, team=${cascade[0]?.team}, preferences=${cascade[0]?.preferences}, revokedGrants=${cascade[0]?.revoked}, retirementJobs=${cascade[0]?.jobs}`,
  );
}
