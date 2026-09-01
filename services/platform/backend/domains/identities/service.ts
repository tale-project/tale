import type { Sql, TransactionSql } from 'postgres';

import {
  buildExternalOwnerId,
  isExternalOwnerId,
} from '../../core/identities/external_identities_helpers.ts';

/**
 * External author identities — the 0.4 `identities/external_identities.ts`
 * on Postgres.
 *
 * People who write in from a connected Slack workspace have no account here,
 * so their display name has to come from somewhere: this table. The owner id
 * is built by the REUSED pure helper (namespaced and org-scoped), which is
 * also what lets every name-resolution lane tell an external author from a
 * Better Auth user id without a lookup.
 */

export type ExternalIdentitySource = 'slack';

export interface UpsertExternalIdentityArgs {
  source: ExternalIdentitySource;
  organizationId: string;
  externalUserId: string;
  displayName?: string;
  handle?: string;
  avatarUrl?: string;
}

/**
 * Record (or refresh) one external identity and return its owner id.
 *
 * A round that fetched NOTHING must not touch `updated_at_ms`: that column is
 * the freshness window the caller uses to decide whether to re-fetch, and
 * resetting it on a failed fetch would suppress retries until it expired
 * (the 0.4 rule, kept).
 */
export async function upsertExternalIdentity(
  sql: Sql | TransactionSql,
  args: UpsertExternalIdentityArgs,
): Promise<string> {
  const ownerId = buildExternalOwnerId(
    args.source,
    args.externalUserId,
    args.organizationId,
  );
  const now = Date.now();
  const gotNewData =
    args.displayName !== undefined ||
    args.handle !== undefined ||
    args.avatarUrl !== undefined;

  await sql`
    INSERT INTO app.external_identities (
      owner_id, source, org_id, external_user_id, display_name, handle,
      avatar_url, created_at_ms, updated_at_ms
    ) VALUES (
      ${ownerId}, ${args.source}, ${args.organizationId},
      ${args.externalUserId}, ${args.displayName ?? null},
      ${args.handle ?? null}, ${args.avatarUrl ?? null}, ${now}, ${now}
    )
    ON CONFLICT (owner_id) DO UPDATE SET
      display_name = coalesce(
        ${args.displayName ?? null}, app.external_identities.display_name
      ),
      handle = coalesce(${args.handle ?? null}, app.external_identities.handle),
      avatar_url = coalesce(
        ${args.avatarUrl ?? null}, app.external_identities.avatar_url
      ),
      updated_at_ms = CASE
        WHEN ${gotNewData} THEN ${now}
        ELSE app.external_identities.updated_at_ms
      END
  `;
  return ownerId;
}

/**
 * Display names for external owner ids — the half of a name-resolution batch
 * that Better Auth cannot answer. Ids that are not external are ignored, so a
 * caller can hand the whole mixed list in.
 */
export async function resolveExternalDisplayNames(
  sql: Sql,
  ownerIds: readonly string[],
): Promise<Map<string, string>> {
  const external = [...new Set(ownerIds.filter((id) => isExternalOwnerId(id)))];
  const names = new Map<string, string>();
  if (external.length === 0) return names;
  const rows = await sql<{ ownerId: string; displayName: string | null }[]>`
    SELECT owner_id AS "ownerId", display_name AS "displayName"
    FROM app.external_identities WHERE owner_id = ANY(${external})
  `;
  for (const row of rows) {
    if (row.displayName !== null && row.displayName !== '') {
      names.set(row.ownerId, row.displayName);
    }
  }
  return names;
}

/** One identity, for the surfaces that render an external author's card. */
export async function getExternalIdentity(
  sql: Sql,
  ownerId: string,
): Promise<{
  ownerId: string;
  source: string;
  organizationId: string;
  externalUserId: string;
  displayName: string | null;
  handle: string | null;
  avatarUrl: string | null;
  updatedAt: number;
} | null> {
  const rows = await sql<
    {
      ownerId: string;
      source: string;
      organizationId: string;
      externalUserId: string;
      displayName: string | null;
      handle: string | null;
      avatarUrl: string | null;
      updatedAt: number;
    }[]
  >`
    SELECT owner_id AS "ownerId", source, org_id AS "organizationId",
           external_user_id AS "externalUserId",
           display_name AS "displayName", handle, avatar_url AS "avatarUrl",
           updated_at_ms::float8 AS "updatedAt"
    FROM app.external_identities WHERE owner_id = ${ownerId} LIMIT 1
  `;
  return rows[0] ?? null;
}
