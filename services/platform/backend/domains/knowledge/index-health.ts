import type { Sql } from 'postgres';

import { logger } from '../../../lib/knowledge/logger.ts';
import type { CreateAuditLogArgs } from '../../core/audit_logs/types.ts';
import {
  allowCorpusWrites,
  healBm25Indexes,
  humanBytes,
  indexName,
  rebuildBm25IndexInBackground,
  refuseCorpusWrites,
  type Bm25Index,
  type IndexCheck,
  type IndexHealthReport,
  type IndexReport,
  type RepairPath,
} from '../../core/knowledge/index_health.ts';
import {
  defaultKnowledgeUrl,
  resolveOrgUrl,
  setCorpusBootstrapHook,
} from '../../core/knowledge/pool.ts';
import { RAG_ERROR_INDEX_REBUILDING } from '../../core/knowledge/rag_error_codes.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import {
  writeNotificationForOrgs,
  type WriteNotificationArgs,
} from '../notifications/service.ts';

/**
 * Knowledge index health — the boot step, the bring-your-own hook, and the
 * background rebuild job, wired to what the product does about an outcome.
 *
 * The DECISION (verify, rebuild inline or defer, one attempt per index, the
 * advisory lock) is `core/knowledge/index_health.ts`; this module turns each
 * outcome into effects on the app side: the corpus write guard, the
 * `knowledge.reindex_bm25` job for a deferred rebuild, and — because a
 * corrupted index is never silent — an audit row (actor `system`, the same
 * shape the retention sweep and erasure cascades write) plus an admin bell
 * (the `security` category is the admin-only channel the website-scan-paused
 * and audit-integrity alerts already use) for every organization whose corpus
 * lives in that database. Effects are injectable so the state machine is
 * unit-tested with spies and the integration harness runs the real ones.
 */

export type CorpusScope =
  | { readonly kind: 'default' }
  | { readonly kind: 'org'; readonly orgSlug: string };

export type IndexHealthEvent =
  | {
      readonly kind: 'repaired';
      readonly index: Bm25Index;
      readonly path: RepairPath;
      readonly reindexMs: number;
      readonly reason: string;
      readonly checks: readonly IndexCheck[];
    }
  | {
      readonly kind: 'rebuild_scheduled';
      readonly index: Bm25Index;
      readonly reason: string;
    }
  | {
      readonly kind: 'repair_failed';
      readonly index: Bm25Index;
      readonly path: RepairPath | null;
      readonly reindexMs: number;
      readonly reason: string;
      readonly error: string;
    };

/** What an outcome does on the app side — production or spies. */
export interface IndexHealthEffects {
  /** Queue the background `REINDEX CONCURRENTLY` of one deferred index. */
  scheduleRebuild(scope: CorpusScope, index: Bm25Index): Promise<void>;
  /** Audit row + admin bell for every organization on that database. */
  announce(
    scope: CorpusScope,
    url: string,
    event: IndexHealthEvent,
    stamp: number,
  ): Promise<void>;
  /** After a verified rebuild: re-queue the files refused while it ran. */
  requeueRefused(scope: CorpusScope, url: string): Promise<number>;
}

const DEFAULT_LABEL = 'the deployment-default knowledge database';

function labelFor(scope: CorpusScope): string {
  return scope.kind === 'default'
    ? DEFAULT_LABEL
    : `the knowledge database of organization "${scope.orgSlug}"`;
}

/**
 * The boot step: verify (and repair) the deployment-default corpus's BM25
 * indexes, then act on the report. Every role runs it before it serves or
 * consumes jobs; never throws past the report's own logging.
 */
export async function verifyDefaultKnowledgeIndexes(
  sql: Sql,
  effects: IndexHealthEffects = productionEffects(sql),
): Promise<IndexHealthReport> {
  const url = defaultKnowledgeUrl();
  const report = await healBm25Indexes({ url, label: DEFAULT_LABEL });
  await applyIndexHealthReport(report, { kind: 'default' }, url, effects);
  return report;
}

/**
 * Make every bring-your-own corpus bootstrap (the pool's single flight, after
 * its schema is current) verify that database's BM25 indexes the same way.
 */
export function installCorpusHealthHook(
  sql: Sql,
  effects: IndexHealthEffects = productionEffects(sql),
): void {
  setCorpusBootstrapHook(async ({ url, orgSlug }) => {
    const scope: CorpusScope = { kind: 'org', orgSlug };
    const report = await healBm25Indexes({ url, label: labelFor(scope) });
    await applyIndexHealthReport(report, scope, url, effects);
  });
}

/** Turn a verification report into effects, index by index. */
export async function applyIndexHealthReport(
  report: IndexHealthReport,
  scope: CorpusScope,
  url: string,
  effects: IndexHealthEffects,
): Promise<void> {
  for (const entry of report.indexes) {
    await applyOutcome(entry, scope, url, report.startedAt, effects);
  }
}

async function applyOutcome(
  entry: IndexReport,
  scope: CorpusScope,
  url: string,
  stamp: number,
  effects: IndexHealthEffects,
): Promise<void> {
  const { index, outcome } = entry;
  switch (outcome.kind) {
    case 'deferred':
      refuseCorpusWrites(url, index.schema, { state: 'rebuilding', index });
      await effects.scheduleRebuild(scope, index);
      await effects.announce(
        scope,
        url,
        { kind: 'rebuild_scheduled', index, reason: outcome.reason },
        stamp,
      );
      return;
    case 'repaired':
      await effects.announce(
        scope,
        url,
        {
          kind: 'repaired',
          index,
          path: outcome.path,
          reindexMs: outcome.reindexMs,
          reason: outcome.reason,
          checks: outcome.checks,
        },
        stamp,
      );
      return;
    case 'repair_failed':
      refuseCorpusWrites(url, index.schema, { state: 'repair_failed', index });
      await effects.announce(
        scope,
        url,
        {
          kind: 'repair_failed',
          index,
          path: outcome.path,
          reindexMs: outcome.reindexMs,
          reason: outcome.reason,
          error: outcome.error,
        },
        stamp,
      );
      return;
    case 'not_retried':
      refuseCorpusWrites(url, index.schema, { state: 'repair_failed', index });
      await effects.announce(
        scope,
        url,
        {
          kind: 'repair_failed',
          index,
          path: null,
          reindexMs: 0,
          reason: outcome.reason,
          error:
            'not retried — this process already rebuilt the index once and it is still unhealthy',
        },
        stamp,
      );
      return;
    case 'healthy':
    case 'unverifiable':
    case 'invalid':
    case 'missing':
      return;
    default:
      return;
  }
}

/** The `knowledge.reindex_bm25` job payload (validated by the task list). */
export interface ReindexBm25Payload {
  readonly orgSlug: string | null;
  readonly schema: string;
  readonly name: string;
}

/**
 * The `knowledge.reindex_bm25` job: rebuild one deferred index concurrently,
 * then lift or harden the write refusal and announce the outcome. A verified
 * rebuild re-queues every file refused while it ran, so nothing stays parked
 * behind a repair that already happened.
 */
export async function runReindexBm25Job(
  sql: Sql,
  payload: ReindexBm25Payload,
  effects: IndexHealthEffects = productionEffects(sql),
  rebuild: typeof rebuildBm25IndexInBackground = rebuildBm25IndexInBackground,
): Promise<void> {
  const scope: CorpusScope =
    payload.orgSlug === null
      ? { kind: 'default' }
      : { kind: 'org', orgSlug: payload.orgSlug };
  const url =
    scope.kind === 'default'
      ? defaultKnowledgeUrl()
      : await resolveOrgUrl(scope.orgSlug);
  const stamp = Date.now();
  const { index, outcome } = await rebuild({
    url,
    label: labelFor(scope),
    index: { schema: payload.schema, name: payload.name },
  });
  switch (outcome.kind) {
    case 'repaired': {
      allowCorpusWrites(url, index.schema);
      await effects.announce(
        scope,
        url,
        {
          kind: 'repaired',
          index,
          path: outcome.path,
          reindexMs: outcome.reindexMs,
          reason: outcome.reason,
          checks: outcome.checks,
        },
        stamp,
      );
      const requeued = await effects.requeueRefused(scope, url);
      logger.info(
        `${labelFor(scope)}: re-queued ${requeued} file(s) whose indexing was refused while ${indexName(index)} was rebuilt`,
      );
      return;
    }
    case 'healthy': {
      // Rebuilt elsewhere (a sibling process, an operator) before this job
      // ran — the refusal is stale, and so are the files it turned away.
      allowCorpusWrites(url, index.schema);
      await effects.requeueRefused(scope, url);
      return;
    }
    case 'missing':
      allowCorpusWrites(url, payload.schema);
      return;
    case 'repair_failed':
      refuseCorpusWrites(url, index.schema, { state: 'repair_failed', index });
      await effects.announce(
        scope,
        url,
        {
          kind: 'repair_failed',
          index,
          path: outcome.path,
          reindexMs: outcome.reindexMs,
          reason: outcome.reason,
          error: outcome.error,
        },
        stamp,
      );
      return;
    case 'not_retried':
      refuseCorpusWrites(url, index.schema, { state: 'repair_failed', index });
      await effects.announce(
        scope,
        url,
        {
          kind: 'repair_failed',
          index,
          path: 'background',
          reindexMs: 0,
          reason: outcome.reason,
          error:
            'not retried — this process already rebuilt the index once and it is still unhealthy',
        },
        stamp,
      );
      return;
    case 'unverifiable':
    case 'invalid':
    case 'deferred':
      return;
    default:
      return;
  }
}

// ------------------------------------------------------- production effects

/** The real effects: the pg-boss job, the audit chain, the bell, the requeue. */
export function productionEffects(sql: Sql): IndexHealthEffects {
  return {
    async scheduleRebuild(scope, index) {
      const orgSlug = scope.kind === 'org' ? scope.orgSlug : null;
      await addJobInTx(
        sql,
        'knowledge.reindex_bm25',
        { orgSlug, schema: index.schema, name: index.name },
        // One queued rebuild per (database, index): a concurrently booting
        // api and worker both defer the same index.
        { singletonKey: `${orgSlug ?? 'default'}:${indexName(index)}` },
      );
    },
    async announce(scope, url, event, stamp) {
      const orgs = await affectedOrganizations(sql, scope, url);
      if (orgs.length === 0) {
        logger.warn(
          `no organization uses ${labelFor(scope)} yet — ${event.kind} for ${indexName(event.index)} is on record in the logs only`,
        );
        return;
      }
      for (const org of orgs) {
        await sql.begin(async (tx) => {
          await createAuditLog(tx, auditArgs(org.id, event));
          await writeNotificationForOrgs(
            tx,
            notificationArgs(org.id, event, stamp),
          );
        });
      }
    },
    async requeueRefused(scope, url) {
      const orgs = await affectedOrganizations(sql, scope, url);
      return requeueRefusedFiles(
        sql,
        orgs.map((org) => org.id),
      );
    },
  };
}

/**
 * The organizations whose corpus lives in `url`: the one organization of an
 * org scope, or — for the deployment default — every organization that does
 * NOT bring its own database, decided by the same resolver the pool routes
 * through, so this can never name a tenant whose data is elsewhere.
 */
async function affectedOrganizations(
  sql: Sql,
  scope: CorpusScope,
  url: string,
): Promise<{ id: string; slug: string }[]> {
  if (scope.kind === 'org') {
    return sql<{ id: string; slug: string }[]>`
      SELECT "id", "slug" FROM "organization"
      WHERE "slug" = ${scope.orgSlug}
      LIMIT 1
    `;
  }
  const rows = await sql<{ id: string; slug: string | null }[]>`
    SELECT "id", "slug" FROM "organization"
    WHERE "slug" IS NOT NULL
    ORDER BY "id"
  `;
  const affected: { id: string; slug: string }[] = [];
  for (const row of rows) {
    if (row.slug === null) continue;
    try {
      if ((await resolveOrgUrl(row.slug)) === url) {
        affected.push({ id: row.id, slug: row.slug });
      }
    } catch (error) {
      logger.warn(
        `could not resolve the knowledge database of organization "${row.slug}" — not notifying it: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return affected;
}

function auditArgs(
  organizationId: string,
  event: IndexHealthEvent,
): CreateAuditLogArgs {
  const index = indexName(event.index);
  const base = {
    organizationId,
    actorId: 'system',
    actorType: 'system' as const,
    category: 'admin' as const,
    resourceType: 'knowledge_index',
    resourceId: index,
    resourceName: index,
  };
  switch (event.kind) {
    case 'repaired':
      return {
        ...base,
        action: 'knowledge_index_repaired',
        status: 'success',
        newState: {
          index,
          sizeBytes: event.index.sizeBytes,
          path: event.path,
          reindexMs: event.reindexMs,
          reason: event.reason,
          checks: event.checks.map(
            (check) => `${check.check}: ${check.details}`,
          ),
        },
      };
    case 'rebuild_scheduled':
      return {
        ...base,
        action: 'knowledge_index_rebuild_scheduled',
        status: 'success',
        newState: {
          index,
          sizeBytes: event.index.sizeBytes,
          path: 'background',
          reason: event.reason,
        },
      };
    case 'repair_failed':
      return {
        ...base,
        action: 'knowledge_index_repair_failed',
        status: 'failure',
        errorMessage: event.error,
        newState: {
          index,
          sizeBytes: event.index.sizeBytes,
          path: event.path,
          reindexMs: event.reindexMs,
          reason: event.reason,
        },
      };
    default:
      throw new Error('unreachable: unknown index health event');
  }
}

function notificationArgs(
  organizationId: string,
  event: IndexHealthEvent,
  stamp: number,
): WriteNotificationArgs {
  const index = indexName(event.index);
  const size = humanBytes(event.index.sizeBytes);
  const shared = {
    organizationIds: [organizationId],
    category: 'security' as const,
    link: { kind: 'audit-logs' },
    dedupeKey: `knowledge-index:${event.kind}:${index}:${stamp}`,
  };
  switch (event.kind) {
    case 'repaired':
      return {
        ...shared,
        severity: 'warning',
        titleKey: 'knowledgeIndexRepaired',
        bodyKey: 'knowledgeIndexRepairedDetails',
        params: { index, size },
      };
    case 'rebuild_scheduled':
      return {
        ...shared,
        severity: 'warning',
        titleKey: 'knowledgeIndexRebuilding',
        bodyKey: 'knowledgeIndexRebuildingDetails',
        params: { index, size },
      };
    case 'repair_failed':
      return {
        ...shared,
        severity: 'critical',
        titleKey: 'knowledgeIndexRepairFailed',
        bodyKey: 'knowledgeIndexRepairFailedDetails',
        params: { index, reason: event.error.slice(0, 300) },
      };
    default:
      throw new Error('unreachable: unknown index health event');
  }
}

/** Rows per requeue transaction — bounded work per lock hold. */
const REQUEUE_BATCH = 200;

/**
 * Re-queue every file whose indexing was refused because the index was being
 * rebuilt, in id order, a bounded batch per transaction, until none is left.
 * Clearing the code in the same UPDATE is what makes the loop terminate; the
 * hint refreshes the document lists already showing the parked rows.
 */
async function requeueRefusedFiles(
  sql: Sql,
  orgIds: readonly string[],
): Promise<number> {
  if (orgIds.length === 0) return 0;
  let total = 0;
  for (;;) {
    const requeued = await sql.begin(async (tx) => {
      const rows = await tx<{ id: string; orgId: string }[]>`
        WITH picked AS (
          SELECT id FROM app.file_metadata
           WHERE rag_error_code = ${RAG_ERROR_INDEX_REBUILDING}
             AND org_id = ANY(${[...orgIds]})
           ORDER BY id
           LIMIT ${REQUEUE_BATCH}
           FOR UPDATE SKIP LOCKED
        )
        UPDATE app.file_metadata f
           SET rag_status = 'queued', rag_error = NULL, rag_error_code = NULL,
               rag_queued_at_ms = ${Date.now()}
          FROM picked
         WHERE f.id = picked.id
        RETURNING f.id, f.org_id AS "orgId"
      `;
      for (const row of rows) {
        await addJobInTx(tx, 'rag.index_file', { fileId: row.id });
      }
      for (const orgId of new Set(rows.map((row) => row.orgId))) {
        await emitHintInTx(tx, { orgId, entity: 'document', entityId: null });
      }
      return rows.length;
    });
    total += requeued;
    if (requeued < REQUEUE_BATCH) return total;
  }
}
