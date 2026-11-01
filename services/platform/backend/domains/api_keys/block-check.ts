import type { Sql, TransactionSql } from 'postgres';

/**
 * What the REST door reads of an organization's blocks on its members' own
 * API keys (APIKEY-R11, `app.api_key_org_blocks`, migration 0231). Kept
 * apart from `blocks.ts`, which blocks and frees keys for the app's
 * settings, so that the door reaches only these two reads.
 */

type Db = Sql | TransactionSql;

/** Whether this organization has blocked this key. One primary-key read. */
export async function isApiKeyBlockedInOrg(
  db: Db,
  organizationId: string,
  apiKeyId: string,
): Promise<boolean> {
  const rows = await db<{ one: number }[]>`
    SELECT 1 AS one FROM app.api_key_org_blocks
    WHERE org_id = ${organizationId} AND api_key_id = ${apiKeyId}
    LIMIT 1
  `;
  return rows.length > 0;
}

/**
 * The slugs of the organizations that have blocked this key, so that a
 * refusal lists only the organizations where it still works.
 */
export async function listBlockingOrgSlugs(
  db: Db,
  apiKeyId: string,
): Promise<Set<string>> {
  const rows = await db<{ slug: string | null }[]>`
    SELECT o."slug" FROM app.api_key_org_blocks b
    JOIN "organization" o ON o."id" = b.org_id
    WHERE b.api_key_id = ${apiKeyId}
  `;
  return new Set(rows.flatMap((row) => (row.slug === null ? [] : [row.slug])));
}
