import type { Sql } from 'postgres';

import type { ApiKeyOwnerKind } from '../api_keys/owners.ts';

/** Whose key it is: a person's own (`user`), one made for a member, or a
 * team's, a project's or the organization's own key. */
export type OrgApiKeyOwnerKind = 'user' | ApiKeyOwnerKind;

/** What a listed key belongs to beyond a person: its team or project. */
export interface OrgApiKeyScope {
  ownerKind: OrgApiKeyOwnerKind;
  teamId: string | null;
  teamName: string | null;
  projectId: string | null;
  projectName: string | null;
}

/**
 * The API keys the budget editor can cap: every key that can still spend in
 * this organization (neither disabled nor expired), masked — the personal
 * keys of its members, which work in each organization they belong to, and
 * the keys bound to it alone: the ones made for a member, and the teams',
 * the projects' and the organization's own. A non-member's personal key and
 * a key bound to another organization are never listed, and a cap applies
 * to the key's spend in this organization. The secret never leaves the auth
 * store; the key's visible `start` is what was shown when it was made.
 */
export interface OrgApiKey extends OrgApiKeyScope {
  id: string;
  name: string | null;
  /** The key's first characters, as shown when it was made. */
  start: string | null;
  /** The person the key acts as; null for a key that is not a person. */
  userId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  createdAt: number;
  expiresAt: number | null;
}

/** A generous bound: the picker is a select, not a paginated table. */
const ORG_API_KEY_LIMIT = 1000;

export async function listOrgApiKeys(
  sql: Sql,
  organizationId: string,
): Promise<OrgApiKey[]> {
  const rows = await sql<
    {
      id: string;
      name: string | null;
      start: string | null;
      userId: string | null;
      ownerName: string | null;
      ownerEmail: string | null;
      createdAt: Date;
      expiresAt: Date | null;
      ownerKind: OrgApiKeyOwnerKind;
      teamId: string | null;
      teamName: string | null;
      projectId: string | null;
      projectName: string | null;
    }[]
  >`
    SELECT k."id", k."name", k."start",
           CASE WHEN o.api_key_id IS NULL OR o.owner_kind = 'member'
                THEN k."referenceId" END AS "userId",
           u."name" AS "ownerName", u."email" AS "ownerEmail",
           k."createdAt", k."expiresAt",
           coalesce(o.owner_kind, 'user') AS "ownerKind",
           o.team_id AS "teamId", t."name" AS "teamName",
           o.project_id AS "projectId", p.name AS "projectName"
    FROM "apikey" k
    LEFT JOIN app.api_key_owners o ON o.api_key_id = k."id"
    LEFT JOIN "member" m
      ON o.api_key_id IS NULL
     AND m."userId" = k."referenceId"
     AND m."organizationId" = ${organizationId}
    LEFT JOIN "user" u
      ON (o.api_key_id IS NULL OR o.owner_kind = 'member')
     AND u."id" = k."referenceId"
    LEFT JOIN "team" t ON t."id" = o.team_id
    LEFT JOIN app.projects p ON p.id = o.project_id
    WHERE k."enabled" IS NOT FALSE
      AND (k."expiresAt" IS NULL OR k."expiresAt" > now())
      AND ((o.api_key_id IS NULL AND m."id" IS NOT NULL)
           OR (o.org_id = ${organizationId} AND o.revoked_at_ms IS NULL))
    ORDER BY u."name" NULLS LAST, k."createdAt"
    LIMIT ${ORG_API_KEY_LIMIT}
  `;
  if (rows.length >= ORG_API_KEY_LIMIT) {
    // A key past the bound is missing from the picker, and a rule on it shows
    // its raw id in the Target cell: say so where an operator can see it.
    console.warn(
      `[governance/api-keys] organization ${organizationId} holds ${ORG_API_KEY_LIMIT} or more live keys; the budget picker lists the first ${ORG_API_KEY_LIMIT}`,
    );
  }
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    start: row.start,
    userId: row.userId,
    ownerName: row.ownerName,
    ownerEmail: row.ownerEmail,
    createdAt: row.createdAt.getTime(),
    expiresAt: row.expiresAt === null ? null : row.expiresAt.getTime(),
    ownerKind: row.ownerKind,
    teamId: row.teamId,
    teamName: row.teamName,
    projectId: row.projectId,
    projectName: row.projectName,
  }));
}

/**
 * Why a key a budget rule names is not in the picker's listing: it can no
 * longer spend here, or this organization knows nothing about it.
 *
 *  - `expired` / `disabled` — the key is still held by a member.
 *  - `holder_left` — its holder is no longer a member; what became of the
 *    key since is theirs, not this organization's, to know.
 *  - `revoked` — the key is gone and this organization's audit trail
 *    recorded the revoke.
 *  - `unavailable` — a member's known key is gone, but this organization
 *    has no recorded cause. Expiry cleanup also removes keys without a revoke.
 *  - `unknown` — no member holds it and the audit trail never saw it.
 *  - `active` — a live key past the listing's bound.
 */
export type RuleApiKeyStatus =
  | 'active'
  | 'expired'
  | 'disabled'
  | 'holder_left'
  | 'revoked'
  | 'unavailable'
  | 'unknown';

/**
 * A key one of the organization's budget rules names, as far as this
 * organization may describe it. A rule stores the key's bare id, and a key
 * outlives neither its owner's revoke nor its expiry in the listing above —
 * so the rule table read a revoked, expired or disabled key as a string of
 * random characters, with no name and no owner.
 */
export interface RuleApiKey extends OrgApiKeyScope {
  id: string;
  name: string | null;
  start: string | null;
  /** The holder, when this organization knows who that is. */
  userId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  status: RuleApiKeyStatus;
  expiresAt: number | null;
}

/**
 * Describe the keys budget rules name that the live listing does not carry.
 *
 * A key is described only on this organization's own evidence: its holder
 * is a member now, or the organization's audit trail recorded them creating
 * the key while they were one (`api_key.created` lands in every organization
 * of the holder). For a holder who left, that record is all it says — the
 * key's name and the address as they were when it was created, never the
 * person's current profile or what the key became since: whether they
 * deleted it after leaving is not this organization's to see, so its state
 * comes from the same trail (a revoke lands in the organizations the holder
 * belongs to at the time), never from the auth store's row. A key id that
 * matches neither — a holder who was never a member here, or an id that
 * names nothing — answers `unknown`, exactly alike, so a saved rule cannot be
 * used to ask whether a key exists or whose it is elsewhere on the
 * deployment.
 */
export async function describeRuleApiKeys(
  sql: Sql,
  organizationId: string,
  keyIds: readonly string[],
): Promise<RuleApiKey[]> {
  const ids = [...new Set(keyIds)];
  if (ids.length === 0) return [];

  // A key bound to this organization is described by its own binding: who
  // it was made for, its team or project, and whether it was revoked. The
  // organization knows all of that first-hand.
  const boundRows = await sql<
    {
      id: string;
      ownerKind: Exclude<OrgApiKeyOwnerKind, 'user'>;
      principalUserId: string;
      teamId: string | null;
      teamName: string | null;
      projectId: string | null;
      projectName: string | null;
      name: string;
      revokedAt: string | null;
      keyRowId: string | null;
      start: string | null;
      enabled: boolean | null;
      expired: boolean | null;
      expiresAt: Date | null;
      memberName: string | null;
      memberEmail: string | null;
    }[]
  >`
    SELECT o.api_key_id AS "id", o.owner_kind AS "ownerKind",
           o.principal_user_id AS "principalUserId",
           o.team_id AS "teamId", t."name" AS "teamName",
           o.project_id AS "projectId", p.name AS "projectName",
           o.name, o.revoked_at_ms AS "revokedAt",
           k."id" AS "keyRowId", k."start", k."enabled",
           (k."expiresAt" IS NOT NULL AND k."expiresAt" <= now()) AS "expired",
           k."expiresAt",
           mu."name" AS "memberName", mu."email" AS "memberEmail"
    FROM app.api_key_owners o
    LEFT JOIN "apikey" k ON k."id" = o.api_key_id
    LEFT JOIN "team" t ON t."id" = o.team_id
    LEFT JOIN app.projects p ON p.id = o.project_id
    LEFT JOIN "member" mm
      ON o.owner_kind = 'member'
     AND mm."userId" = o.principal_user_id
     AND mm."organizationId" = o.org_id
    LEFT JOIN "user" mu ON mm."id" IS NOT NULL AND mu."id" = mm."userId"
    WHERE o.org_id = ${organizationId} AND o.api_key_id = ANY(${ids})
  `;
  const boundById = new Map(boundRows.map((row) => [row.id, row]));

  // The auth store answers for current members' own keys only — the rows
  // the live listing reads too. A key held by anyone else, or bound to any
  // organization (this one's are described above; another's says nothing
  // here), is not looked up there.
  const held = await sql<
    {
      id: string;
      name: string | null;
      start: string | null;
      enabled: boolean | null;
      expired: boolean;
      expiresAt: Date | null;
      holderId: string;
    }[]
  >`
    SELECT k."id", k."name", k."start", k."enabled",
           (k."expiresAt" IS NOT NULL AND k."expiresAt" <= now()) AS "expired",
           k."expiresAt", k."referenceId" AS "holderId"
    FROM "apikey" k
    JOIN "member" m
      ON m."userId" = k."referenceId" AND m."organizationId" = ${organizationId}
    WHERE k."id" = ANY(${ids})
      AND NOT EXISTS (
        SELECT 1 FROM app.api_key_owners o WHERE o.api_key_id = k."id"
      )
  `;
  // The trail's latest creation and latest revoke of each key. A key made
  // before its holder joined has no creation here, but a revoke while they
  // were a member landed here all the same.
  const trail = await sql<
    {
      id: string;
      action: string;
      actorId: string;
      actorEmail: string | null;
      name: string | null;
      start: string | null;
    }[]
  >`
    SELECT DISTINCT ON (resource_id, action)
           resource_id AS "id", action, actor_id AS "actorId",
           actor_email AS "actorEmail", resource_name AS "name",
           new_state->>'start' AS "start"
    FROM app.audit_logs
    WHERE org_id = ${organizationId} AND resource_type = 'api_key'
      AND action IN ('api_key.created', 'api_key.revoked')
      AND resource_id = ANY(${ids})
    ORDER BY resource_id, action, ts DESC
  `;
  const heldById = new Map(held.map((row) => [row.id, row]));
  const createdById = new Map(
    trail
      .filter((row) => row.action === 'api_key.created')
      .map((row) => [row.id, row]),
  );
  const revokedById = new Map(
    trail
      .filter((row) => row.action === 'api_key.revoked')
      .map((row) => [row.id, row]),
  );

  /** Who this organization may name as the key's holder, or null. */
  const holderOf = (id: string): string | null =>
    heldById.get(id)?.holderId ??
    createdById.get(id)?.actorId ??
    revokedById.get(id)?.actorId ??
    null;
  const holderIds = [...new Set(ids.map(holderOf).filter((id) => id !== null))];
  // Current profiles of current members only.
  const members =
    holderIds.length === 0
      ? []
      : await sql<{ id: string; name: string | null; email: string | null }[]>`
          SELECT u."id", u."name", u."email"
          FROM "user" u
          JOIN "member" m
            ON m."userId" = u."id" AND m."organizationId" = ${organizationId}
          WHERE u."id" = ANY(${holderIds})
        `;
  const memberById = new Map(members.map((row) => [row.id, row]));

  return ids.map((id): RuleApiKey => {
    const bound = boundById.get(id);
    if (bound !== undefined) {
      const status: RuleApiKeyStatus =
        bound.revokedAt !== null
          ? 'revoked'
          : bound.keyRowId === null
            ? 'unavailable'
            : bound.enabled === false
              ? 'disabled'
              : bound.expired === true
                ? 'expired'
                : 'active';
      return {
        id,
        name: bound.name,
        start: bound.start,
        userId: bound.ownerKind === 'member' ? bound.principalUserId : null,
        ownerName: bound.memberName,
        ownerEmail: bound.memberEmail,
        status,
        expiresAt: bound.expiresAt === null ? null : bound.expiresAt.getTime(),
        ownerKind: bound.ownerKind,
        teamId: bound.teamId,
        teamName: bound.teamName,
        projectId: bound.projectId,
        projectName: bound.projectName,
      };
    }
    // The key row speaks for a member's key; for any other, the audit trail.
    const current = heldById.get(id);
    const audit = createdById.get(id);
    const revoke = revokedById.get(id);
    const holderId = holderOf(id);
    const member = holderId === null ? undefined : memberById.get(holderId);
    const status: RuleApiKeyStatus =
      current !== undefined
        ? current.enabled === false
          ? 'disabled'
          : current.expired
            ? 'expired'
            : 'active'
        : audit === undefined && revoke === undefined
          ? 'unknown'
          : // Absence is not evidence of a revoke. What happened to a
            // former member's key remains private to them.
            revoke !== undefined
            ? 'revoked'
            : member !== undefined
              ? 'unavailable'
              : 'holder_left';
    return {
      id,
      name: current !== undefined ? current.name : (audit?.name ?? null),
      start: current !== undefined ? current.start : (audit?.start ?? null),
      userId: holderId,
      ownerName: member?.name ?? null,
      // Someone who left, or whose account is gone, is named by the address
      // the audit row recorded.
      ownerEmail:
        member?.email ??
        (holderId !== null && holderId === audit?.actorId
          ? audit.actorEmail
          : holderId !== null && holderId === revoke?.actorId
            ? revoke.actorEmail
            : null),
      status,
      expiresAt:
        current?.expiresAt != null ? current.expiresAt.getTime() : null,
      // A person's own key: no team, project or organization owns it.
      ownerKind: 'user',
      teamId: null,
      teamName: null,
      projectId: null,
      projectName: null,
    };
  });
}

/**
 * Whether `userId` holds an API key of any state that works in this
 * organization: one of their own, or one made for them here. Whatever the
 * create rule says today — a developer moved to a lower role, a revoked
 * competence — the holder keeps seeing those keys, and revoking them.
 */
export async function holdsApiKeys(
  sql: Sql,
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    SELECT k."id" FROM "apikey" k
    LEFT JOIN app.api_key_owners o ON o.api_key_id = k."id"
    WHERE k."referenceId" = ${userId}
      AND (o.api_key_id IS NULL
           OR (o.org_id = ${organizationId} AND o.revoked_at_ms IS NULL))
    LIMIT 1
  `;
  return rows.length > 0;
}
