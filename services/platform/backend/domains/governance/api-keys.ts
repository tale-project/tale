import type { Sql } from 'postgres';

/**
 * The API keys the budget editor can cap: every key held by a member of this
 * organization that can still spend (neither disabled nor expired), masked.
 * A key belongs to a person and works in each organization they are a member
 * of, so an admin sees the keys of this organization's members only — never
 * a non-member's — and a cap applies to the key's spend in this organization.
 * The secret never leaves the auth store; the key's visible `start` is what
 * the person saw when they created it.
 */
export interface OrgApiKey {
  id: string;
  name: string | null;
  /** The key's first characters, as the owner saw them at creation. */
  start: string | null;
  userId: string;
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
      userId: string;
      ownerName: string | null;
      ownerEmail: string | null;
      createdAt: Date;
      expiresAt: Date | null;
    }[]
  >`
    SELECT k."id", k."name", k."start", k."referenceId" AS "userId",
           u."name" AS "ownerName", u."email" AS "ownerEmail",
           k."createdAt", k."expiresAt"
    FROM "apikey" k
    JOIN "member" m
      ON m."userId" = k."referenceId" AND m."organizationId" = ${organizationId}
    JOIN "user" u ON u."id" = k."referenceId"
    WHERE k."enabled" IS NOT FALSE
      AND (k."expiresAt" IS NULL OR k."expiresAt" > now())
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
export interface RuleApiKey {
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

  // The auth store answers for current members' keys only — the rows the
  // live listing reads too. A key held by anyone else is not looked up there.
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

  return ids.map((id) => {
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
    };
  });
}

/**
 * Whether `userId` holds an API key of any state. Whatever the create rule
 * says today — a developer moved to a lower role, a revoked competence — the
 * holder keeps seeing their own keys, and revoking them.
 */
export async function holdsApiKeys(sql: Sql, userId: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    SELECT "id" FROM "apikey" WHERE "referenceId" = ${userId} LIMIT 1
  `;
  return rows.length > 0;
}
