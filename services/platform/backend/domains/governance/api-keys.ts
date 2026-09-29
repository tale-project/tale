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
