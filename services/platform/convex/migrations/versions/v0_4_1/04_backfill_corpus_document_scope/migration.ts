'use node';

/**
 * Backfill corpus document scope from Convex documents.
 *
 * Retrieval now filters `private_knowledge.documents` by the caller's
 * team/project visibility, but every corpus row written before the scope
 * columns existed carries NULL scope — which reads as "org hub", today's
 * org-wide behaviour. `up` walks each organization's Convex `documents`
 * rows (the scope truth: `teamTags`/`projectId`, mutually exclusive — the
 * FULL team list of a shared document, retrieval being "member of ANY of
 * them" exactly like listing) and stamps `team_ids` (array) plus the
 * deprecated first-element mirror `team_id`, plus `project_id`, onto the
 * matching corpus row, so already-indexed team and project files stop
 * leaking org-wide — and multi-team files stay retrievable by EVERY team
 * they are shared with, not just the first. `down` clears the scope columns
 * back to NULL for the organization, restoring the documented pre-scoping
 * state — the stamps are derived data, recomputable from the Convex rows at
 * any time, which is why `snapshot: 'none'` is sufficient and the migration
 * is not destructive.
 *
 * Idempotent per org in both directions: the UPDATEs are guarded with
 * `IS DISTINCT FROM`, so a resumed fleet run re-converges as a no-op.
 *
 * A corpus that cannot be reached, or that has not received the scope DDL
 * yet (deploy racing the knowledge-db container's own dbmate run), SKIPS the
 * organization with a grep-stable warning instead of failing the deploy:
 * unstamped rows keep serving org-wide exactly as before this migration,
 * ingest and the scope-change sync converge every row they touch, and the
 * operator can replay the backfill with `tale migrate down --to`/`up` once
 * the corpus is migrated. This is also what lets the migration chain run in
 * environments with no knowledge database at all (vitest).
 */

import type { Sql } from 'postgres';

import { PRIVATE_KNOWLEDGE_SCHEMA } from '../../../../../lib/knowledge/types';
import { internal } from '../../../../_generated/api';
import {
  getKnowledgePoolForOrg,
  isUndefinedColumn,
  isUndefinedTable,
} from '../../../../knowledge/pool';
import { defineNodeMigration } from '../../../framework/define';

/** Convex documents read per page while walking one organization. */
const PAGE_SIZE = 200;

/** One (fileId → scope) stamp, as `listDocumentScopePage` projects it —
 * `teamIds` is the full team list, `teamId` its deprecated first-element
 * mirror. */
interface DocumentScope {
  fileId: string;
  teamIds: string[];
  teamId: string | null;
  projectId: string | null;
}

interface ScopePage {
  page: DocumentScope[];
  continueCursor: string | null;
  isDone: boolean;
}

/**
 * Node/postgres.js connection-class failures: the corpus is unreachable, not
 * disagreeing. `CONNECT_TIMEOUT` is postgres.js's own connect failure code.
 */
const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'CONNECT_TIMEOUT',
]);

function isConnectionError(err: unknown): boolean {
  return (
    err instanceof Error &&
    'code' in err &&
    typeof err.code === 'string' &&
    CONNECTION_ERROR_CODES.has(err.code)
  );
}

/** True when the org must be skipped: corpus unreachable, not created, or
 * missing the scope columns (its own DDL migration has not run yet). */
function isCorpusNotReady(err: unknown): boolean {
  return (
    isConnectionError(err) || isUndefinedTable(err) || isUndefinedColumn(err)
  );
}

function skipOrg(
  orgSlug: string,
  direction: 'up' | 'down',
  err: unknown,
): void {
  const detail = err instanceof Error ? err.message : String(err);
  console.warn(
    `[migrations][corpus-scope-backfill] skipped org "${orgSlug}" (${direction}): the knowledge corpus is not reachable/migrated (${detail}). Unstamped rows keep org-wide retrieval; re-run the migration once the corpus is available.`,
  );
}

export const migration = defineNodeMigration({
  title: 'Backfill corpus document scope from Convex documents',
  description:
    'up stamps team_ids (full list, with the deprecated team_id mirror) and project_id onto each organization corpus document row from its Convex document row; down clears the scope columns back to NULL, restoring pre-scoping org-wide retrieval.',
  destructive: false,
  snapshot: 'none',
  // The handlers read the Convex `documents` table (via listDocumentScopePage)
  // and write only the external knowledge corpus.
  subjects: { tables: ['documents'] },

  async up(ctx, org, _helpers) {
    let sql: Sql;
    try {
      sql = await getKnowledgePoolForOrg(org.slug);
    } catch (err) {
      if (isCorpusNotReady(err)) {
        skipOrg(org.slug, 'up', err);
        return;
      }
      throw err;
    }

    let cursor: string | null = null;
    for (;;) {
      const result: ScopePage = await ctx.runQuery(
        internal.documents.internal_queries.listDocumentScopePage,
        { organizationId: org.id, cursor, numItems: PAGE_SIZE },
      );
      for (const scope of result.page) {
        try {
          await sql.unsafe(
            `UPDATE ${PRIVATE_KNOWLEDGE_SCHEMA}.documents
                SET team_ids = $3::text[], team_id = $4, project_id = $5, updated_at = NOW()
              WHERE org_slug = $1 AND file_id = $2
                AND (team_ids IS DISTINCT FROM $3::text[]
                  OR team_id IS DISTINCT FROM $4
                  OR project_id IS DISTINCT FROM $5)`,
            [
              org.slug,
              scope.fileId,
              scope.teamIds.length > 0 ? scope.teamIds : null,
              scope.teamId,
              scope.projectId,
            ],
          );
        } catch (err) {
          if (isCorpusNotReady(err)) {
            skipOrg(org.slug, 'up', err);
            return;
          }
          throw err;
        }
      }
      if (result.isDone || result.continueCursor === null) return;
      cursor = result.continueCursor;
    }
  },

  async down(_ctx, org, _helpers) {
    try {
      const sql = await getKnowledgePoolForOrg(org.slug);
      await sql.unsafe(
        `UPDATE ${PRIVATE_KNOWLEDGE_SCHEMA}.documents
            SET team_ids = NULL, team_id = NULL, project_id = NULL, updated_at = NOW()
          WHERE org_slug = $1
            AND (team_ids IS NOT NULL OR team_id IS NOT NULL OR project_id IS NOT NULL)`,
        [org.slug],
      );
    } catch (err) {
      if (isCorpusNotReady(err)) {
        skipOrg(org.slug, 'down', err);
        return;
      }
      throw err;
    }
  },
});
