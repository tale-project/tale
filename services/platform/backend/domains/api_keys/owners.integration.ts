/** Real HTTP + Postgres proof; mounted by backend/integration-check.ts. */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

import { signUpUser } from '../../integration-lane-helpers.ts';

const createdSchema = z.object({ id: z.string(), key: z.string() });
const meSchema = z.looseObject({
  user: z.looseObject({ id: z.string(), email: z.string() }),
  organizations: z.array(z.looseObject({ id: z.string(), role: z.string() })),
  key: z.looseObject({ owner: z.looseObject({ kind: z.string() }) }).nullable(),
});
const codeSchema = z.looseObject({
  code: z.string().optional(),
  error: z.string().optional(),
});
const projectsSchema = z.looseObject({
  projects: z.array(z.looseObject({ id: z.string() })),
});
const listedSchema = z.object({
  keys: z.array(
    z.looseObject({
      id: z.string(),
      owner: z.looseObject({ kind: z.string() }),
      canRevoke: z.boolean(),
    }),
  ),
});

/**
 * Keys an Owner or Admin makes for others (migration 0154,
 * `domains/api_keys`): the binding table refuses a binding that names the
 * wrong target, a key made at the organization's door works at the REST
 * door in that organization alone, a project's key reaches its project
 * alone, and a key ends with the team, project or member it belongs to —
 * each ending audited as the system's.
 *
 * `ctx` is the suite's owner. The lane makes its own projects, team and
 * member, so the suite's shared rows are untouched.
 */
export async function checkApiKeyOwners(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const { orgId } = ctx;
  const now = Date.now();

  const appDoor = (
    method: 'GET' | 'POST' | 'DELETE',
    route: string,
    payload?: unknown,
    cookie = ctx.cookie,
  ): Promise<Response> =>
    fetch(`${base}/api/app${route}?orgId=${orgId}`, {
      method,
      headers: { 'content-type': 'application/json', cookie, origin: base },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
    });
  const rest = (
    key: string,
    route: string,
    headers: Record<string, string> = {},
  ): Promise<Response> =>
    fetch(`${base}/api/v1${route}`, {
      headers: { authorization: `Bearer ${key}`, ...headers },
    });
  const codeOf = async (response: Response): Promise<string> => {
    const parsed = codeSchema.safeParse(
      await response.json().catch(() => null),
    );
    return parsed.success ? (parsed.data.code ?? parsed.data.error ?? '') : '';
  };
  const make = async (
    name: string,
    owner: Record<string, string>,
  ): Promise<{ id: string; key: string }> => {
    const response = await appDoor('POST', '/api-keys', { name, owner });
    const parsed = createdSchema.safeParse(
      await response.json().catch(() => null),
    );
    return parsed.success && response.status === 201
      ? parsed.data
      : { id: '', key: '' };
  };
  const meOf = async (key: string, headers: Record<string, string> = {}) => {
    const response = await rest(key, '/me', headers);
    const parsed = meSchema.safeParse(await response.json().catch(() => null));
    return { status: response.status, me: parsed.success ? parsed.data : null };
  };
  const projectIdsOf = async (key: string): Promise<string[]> => {
    const parsed = projectsSchema.safeParse(
      await (await rest(key, '/projects')).json().catch(() => null),
    );
    return parsed.success ? parsed.data.projects.map((p) => p.id) : [];
  };
  const retirement = async (keyId: string) => {
    const bindings = await sql<{ revokedAt: string | null }[]>`
      SELECT revoked_at_ms::text AS "revokedAt" FROM app.api_key_owners
      WHERE api_key_id = ${keyId}
    `;
    const secrets = await sql<{ id: string }[]>`
      SELECT "id" FROM "apikey" WHERE "id" = ${keyId}
    `;
    const audits = await sql<{ actorId: string | null; metadata: unknown }[]>`
      SELECT actor_id AS "actorId", metadata FROM app.audit_logs
      WHERE org_id = ${orgId} AND action = 'api_key.revoked'
        AND resource_id = ${keyId}
    `;
    return {
      revoked: bindings[0]?.revokedAt != null,
      secretGone: secrets.length === 0,
      audits,
    };
  };
  let projectSeq = 0;
  const mkProject = async (name: string, teamIds: string[]) => {
    projectSeq += 1;
    const rows = await sql<{ id: string }[]>`
      INSERT INTO app.projects (
        org_id, name, key, team_ids, team_id, shared_with_team_ids,
        created_by, created_at_ms, updated_at_ms
      ) VALUES (
        ${orgId}, ${name}, ${`AK${suffix.slice(0, 4)}${projectSeq}`},
        ${teamIds}, ${teamIds[0] ?? null}, ${teamIds.slice(1)},
        ${ctx.userId}, ${now}, ${now}
      )
      RETURNING id
    `;
    return rows[0]?.id ?? '';
  };
  const mkTeam = async (name: string): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO "team" ("id", "name", "organizationId", "createdAt",
                          "updatedAt")
      VALUES (gen_random_uuid(), ${name}, ${orgId}, ${new Date()},
              ${new Date()})
      RETURNING "id"
    `;
    return rows[0]?.id ?? '';
  };

  // ---- the binding table's own rules
  const violation = async (
    kind: string,
    target: { teamId?: string; projectId?: string; role: string | null },
  ): Promise<string> => {
    try {
      await sql`
        INSERT INTO app.api_key_owners (
          api_key_id, org_id, owner_kind, principal_user_id, team_id,
          project_id, role, name, created_by, created_at_ms
        ) VALUES (
          ${`itest-bad-${randomUUID()}`}, ${orgId}, ${kind},
          ${`itest-principal-${randomUUID()}`}, ${target.teamId ?? null},
          ${target.projectId ?? null}, ${target.role}, 'Refused',
          ${ctx.userId}, ${now}
        )
      `;
      return 'inserted';
    } catch (error) {
      return error !== null && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : String(error);
    }
  };
  const refused = [
    await violation('team', { role: 'member' }),
    await violation('member', { role: 'member' }),
    await violation('project', { projectId: 'p', role: 'admin' }),
    await violation('organization', { teamId: 't', role: 'member' }),
  ];
  record(
    'api key owners: the binding refuses a missing or stray target, a member key with a role, and an admin scoped key',
    refused.every((code) => code === '23514'),
    `codes=${refused.join(',')} (want 23514 x4)`,
  );

  // ---- the organization's own key: its own identity, in this organization
  const orgKey = await make(`Org ${suffix}`, {
    kind: 'organization',
    role: 'member',
  });
  const orgMe = await meOf(orgKey.key);
  const elsewhere = await rest(orgKey.key, '/me', {
    'x-organization-slug': `elsewhere-${suffix}`,
  });
  const elsewhereCode = await codeOf(elsewhere);
  const identity = await sql<{ email: string; memberships: number }[]>`
    SELECT u."email",
           (SELECT count(*) FROM "member" m WHERE m."userId" = u."id")::int
             AS "memberships"
    FROM app.api_key_owners o JOIN "user" u ON u."id" = o.principal_user_id
    WHERE o.api_key_id = ${orgKey.id}
  `;
  record(
    'api key owners: the organization’s key acts as an identity of its own, in its organization alone',
    orgKey.key !== '' &&
      orgMe.status === 200 &&
      orgMe.me?.organizations.length === 1 &&
      orgMe.me.organizations[0]?.id === orgId &&
      orgMe.me.organizations[0]?.role === 'member' &&
      orgMe.me.user.email === '' &&
      orgMe.me.key?.owner.kind === 'organization' &&
      (identity[0]?.email ?? '').endsWith('@api-keys.invalid') &&
      identity[0]?.memberships === 0 &&
      elsewhere.status === 403 &&
      elsewhereCode === 'ORG_FORBIDDEN',
    `me=${orgMe.status} orgs=${orgMe.me?.organizations.length ?? '?'} owner=${orgMe.me?.key?.owner.kind ?? '?'} email=${identity[0]?.email ?? 'MISSING'} memberships=${identity[0]?.memberships ?? '?'} elsewhere=${elsewhere.status}/${elsewhereCode}`,
  );

  // ---- a project's key reaches its project alone, and ends with it
  const ownProject = await mkProject(`Key project ${suffix}`, []);
  const otherProject = await mkProject(`Other project ${suffix}`, []);
  const projectKey = await make(`Project ${suffix}`, {
    kind: 'project',
    projectId: ownProject,
    role: 'developer',
  });
  const listed = await projectIdsOf(projectKey.key);
  const own = await rest(projectKey.key, `/projects/${ownProject}`);
  const other = await rest(projectKey.key, `/projects/${otherProject}`);
  const otherCode = await codeOf(other);
  const contacts = await rest(projectKey.key, '/contacts');
  const contactsCode = await codeOf(contacts);
  record(
    'api key owners: a project’s key reaches its own project and nothing else',
    listed.length === 1 &&
      listed[0] === ownProject &&
      own.status === 200 &&
      other.status === 403 &&
      otherCode === 'API_KEY_SCOPE_FORBIDDEN' &&
      contacts.status === 403 &&
      contactsCode === 'API_KEY_SCOPE_FORBIDDEN',
    `listed=${JSON.stringify(listed)} own=${own.status} other=${other.status}/${otherCode} contacts=${contacts.status}/${contactsCode}`,
  );
  const projectDeleted = await appDoor('DELETE', `/projects/${ownProject}`, {
    mode: 'detach',
  });
  const projectKeyAfter = await rest(projectKey.key, '/me');
  const projectEnd = await retirement(projectKey.id);
  record(
    'api key owners: deleting the project ends its key at once, audited as the system',
    projectDeleted.ok &&
      projectKeyAfter.status === 401 &&
      projectEnd.revoked &&
      projectEnd.secretGone &&
      projectEnd.audits.length === 1 &&
      projectEnd.audits[0]?.actorId === 'system' &&
      JSON.stringify(projectEnd.audits[0]?.metadata).includes(
        'project_deleted',
      ),
    `delete=${projectDeleted.status} after=${projectKeyAfter.status} revoked=${projectEnd.revoked} secretGone=${projectEnd.secretGone} audits=${JSON.stringify(projectEnd.audits)}`,
  );

  // ---- a team's key sees what its team sees, and ends with the team
  const team = await mkTeam(`Key team ${suffix}`);
  const otherTeam = await mkTeam(`Other team ${suffix}`);
  const teamProject = await mkProject(`Team project ${suffix}`, [team]);
  const otherTeamProject = await mkProject(`Other team project ${suffix}`, [
    otherTeam,
  ]);
  const teamKey = await make(`Team ${suffix}`, {
    kind: 'team',
    teamId: team,
    role: 'member',
  });
  const teamListed = await projectIdsOf(teamKey.key);
  record(
    'api key owners: a team’s key sees its team’s projects, never another team’s',
    teamListed.includes(teamProject) &&
      teamListed.includes(otherProject) &&
      !teamListed.includes(otherTeamProject),
    `teamProject=${teamListed.includes(teamProject)} orgWide=${teamListed.includes(otherProject)} otherTeam=${teamListed.includes(otherTeamProject)}`,
  );
  const teamDeleted = await appDoor('DELETE', `/teams/${team}`);
  const teamKeyAfter = await rest(teamKey.key, '/me');
  const teamEnd = await retirement(teamKey.id);
  record(
    'api key owners: deleting the team ends its key at once, audited as the system',
    teamDeleted.ok &&
      teamKeyAfter.status === 401 &&
      teamEnd.revoked &&
      teamEnd.secretGone &&
      teamEnd.audits[0]?.actorId === 'system' &&
      JSON.stringify(teamEnd.audits[0]?.metadata).includes('team_deleted'),
    `delete=${teamDeleted.status} after=${teamKeyAfter.status} revoked=${teamEnd.revoked} secretGone=${teamEnd.secretGone} audits=${JSON.stringify(teamEnd.audits)}`,
  );

  // ---- a member's key acts as the member, who is told and may end it
  const person = await signUpUser(base, `apikey-${suffix}`);
  const memberRowId = randomUUID();
  await sql`
    INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
    VALUES (${memberRowId}, ${orgId}, ${person.userId}, 'member', ${new Date()})
  `;
  const memberKey = await make(`Member ${suffix}`, {
    kind: 'member',
    userId: person.userId,
  });
  const memberMe = await meOf(memberKey.key);
  const notices = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM app.user_notifications
    WHERE user_id = ${person.userId} AND org_id = ${orgId}
      AND type = 'api_key_created'
  `;
  const personList = listedSchema.safeParse(
    await (
      await appDoor('GET', '/api-keys', undefined, person.cookie)
    )
      .json()
      .catch(() => null),
  );
  const personSees = personList.success ? personList.data.keys : [];
  const endOrgKeyAsPerson = await appDoor(
    'DELETE',
    `/api-keys/${orgKey.id}`,
    undefined,
    person.cookie,
  );
  const stretch = await fetch(`${base}/api/auth/api-key/update`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: person.cookie,
      origin: base,
    },
    body: JSON.stringify({ keyId: memberKey.id, name: 'Renamed' }),
  });
  const stretchCode = await codeOf(stretch);
  record(
    'api key owners: a member’s key acts as the member, who is told of it and sees only their own',
    memberMe.status === 200 &&
      memberMe.me?.user.id === person.userId &&
      memberMe.me.user.email === person.email &&
      memberMe.me.organizations.length === 1 &&
      memberMe.me.organizations[0]?.role === 'member' &&
      memberMe.me.key?.owner.kind === 'member' &&
      notices[0]?.count === 1 &&
      personSees.some((key) => key.id === memberKey.id && key.canRevoke) &&
      !personSees.some((key) => key.id === orgKey.id) &&
      endOrgKeyAsPerson.status === 404 &&
      stretch.status === 403 &&
      stretchCode === 'API_KEY_ORGANIZATION_MANAGED',
    `me=${memberMe.status} owner=${memberMe.me?.key?.owner.kind ?? '?'} notices=${notices[0]?.count ?? 0} sees=${JSON.stringify(personSees.map((key) => key.owner.kind))} endOrgKey=${endOrgKeyAsPerson.status} stretch=${stretch.status}/${stretchCode}`,
  );
  const removed = await fetch(
    `${base}/api/app/members/${memberRowId}?orgId=${orgId}`,
    { method: 'DELETE', headers: { cookie: ctx.cookie, origin: base } },
  );
  const memberKeyAfter = await rest(memberKey.key, '/me');
  const memberEnd = await retirement(memberKey.id);
  record(
    'api key owners: removing the member ends the key made for them, audited as the system',
    removed.ok &&
      memberKeyAfter.status === 401 &&
      memberEnd.revoked &&
      memberEnd.secretGone &&
      JSON.stringify(memberEnd.audits[0]?.metadata).includes('member_removed'),
    `remove=${removed.status} after=${memberKeyAfter.status} revoked=${memberEnd.revoked} secretGone=${memberEnd.secretGone} audits=${JSON.stringify(memberEnd.audits)}`,
  );

  // ---- an Owner ends the organization's key at the organization's door
  const ended = await appDoor('DELETE', `/api-keys/${orgKey.id}`);
  const orgKeyAfter = await rest(orgKey.key, '/me');
  const orgEnd = await retirement(orgKey.id);
  record(
    'api key owners: an owner ends the organization’s key, audited under their name',
    ended.ok &&
      orgKeyAfter.status === 401 &&
      orgEnd.revoked &&
      orgEnd.secretGone &&
      orgEnd.audits[0]?.actorId === ctx.userId,
    `end=${ended.status} after=${orgKeyAfter.status} revoked=${orgEnd.revoked} audits=${JSON.stringify(orgEnd.audits)}`,
  );

  await sql`
    DELETE FROM app.projects
    WHERE id IN (${otherProject}, ${teamProject}, ${otherTeamProject})
  `;
  await sql`DELETE FROM "team" WHERE "id" = ${otherTeam}`;
}
