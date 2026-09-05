import type { Sql } from 'postgres';

import { logger } from '../../../lib/knowledge/logger.ts';
import type { CreateAuditLogArgs } from '../../core/audit_logs/types.ts';
import {
  allowCorpusWrites,
  healBm25Indexes,
  humanBytes,
  indexName,
  indexUnavailableMessage,
  rebuildBm25IndexInBackground,
  refuseCorpusWrites,
  setCorpusWritesResumedHook,
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
import {
  RAG_ERROR_INDEX_REBUILDING,
  RAG_ERROR_INDEX_REPAIR_FAILED,
} from '../../core/knowledge/rag_error_codes.ts';
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
  /** Queue the background `REINDEX CONCURRENTLY` of one deferred index —
   * after `delayMs` when the verification could not run yet. */
  scheduleRebuild(
    scope: CorpusScope,
    index: Bm25Index,
    options?: { delayMs?: number },
  ): Promise<void>;
  /** Audit row + admin bell for every organization on that database. */
  announce(
    scope: CorpusScope,
    url: string,
    event: IndexHealthEvent,
    stamp: number,
  ): Promise<void>;
  /** Once the index is healthy: re-queue the files it parked. */
  requeueRefused(scope: CorpusScope, url: string): Promise<number>;
  /** Once a repair is known to have failed: re-stamp the files parked as
   * "rebuilding — resumes automatically" with the operator prose and code,
   * so no row promises a resumption nothing will deliver. */
  failRefused(
    scope: CorpusScope,
    url: string,
    index: Bm25Index,
  ): Promise<number>;
  /** The write guard lifted a refusal itself (the index verified healthy
   * outside any job): re-queue everything parked on that database. */
  resumeRefused(url: string): Promise<number>;
}

/** How long an unverifiable background rebuild waits before it is tried
 * again — long enough for a restarting database, short enough that parked
 * files do not wait on the next boot. */
const UNVERIFIABLE_RETRY_MS = 5 * 60_000;

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
  // The write guard's own lift — a write re-verified the index healthy
  // (rebuilt elsewhere, or an operator's REINDEX) — resumes the files that
  // refusal parked, the same way a job's verified rebuild does.
  setCorpusWritesResumedHook(async ({ url, schema }) => {
    const requeued = await effects.resumeRefused(url);
    if (requeued > 0) {
      logger.info(
        `${schema}: re-queued ${requeued} file(s) parked behind an index that verifies healthy again`,
      );
    }
  });
}

/**
 * Turn a verification report into effects, index by index — then, when the
 * report leaves EVERY index verified healthy (found so, or repaired inline),
 * re-queue the files a previous process parked behind a rebuild or a failed
 * repair. This is the boot-scan twin of the job's healthy arm: a
 * `repair_failed` refusal lives in one process's memory, so after an
 * operator's `REINDEX` and a restart nothing else would ever look at the
 * parked rows again, and their note ("resumes on its own once the index
 * verifies healthy again") would be a lie. Decided per report, not per
 * index, so a database with one healthy and one still-rebuilding index does
 * not re-queue files the guard would only park again.
 */
export async function applyIndexHealthReport(
  report: IndexHealthReport,
  scope: CorpusScope,
  url: string,
  effects: IndexHealthEffects,
): Promise<void> {
  for (const entry of report.indexes) {
    await applyOutcome(entry, scope, url, report.startedAt, effects);
  }
  const allVerifiedHealthy =
    report.indexes.length > 0 &&
    report.indexes.every(
      ({ outcome }) =>
        outcome.kind === 'healthy' || outcome.kind === 'repaired',
    );
  if (!allVerifiedHealthy) return;
  const requeued = await effects.requeueRefused(scope, url);
  if (requeued > 0) {
    logger.info(
      `${labelFor(scope)}: re-queued ${requeued} file(s) parked behind an index that now verifies healthy`,
    );
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
      // Files a previous process parked as "rebuilding — resumes
      // automatically" get the operator prose now, as on the job path.
      await effects.failRefused(scope, url, index);
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
      await effects.failRefused(scope, url, index);
      return;
    case 'healthy':
      // Nothing to do for the index itself; the re-queue of files a previous
      // process parked is decided once per report (`applyIndexHealthReport`).
      return;
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
    case 'missing': {
      // No index to be corrupted: writes flow (the keyword leg is simply
      // absent), and the files parked behind the refusal flow with them.
      allowCorpusWrites(url, payload.schema);
      const requeued = await effects.requeueRefused(scope, url);
      logger.info(
        `${labelFor(scope)}: re-queued ${requeued} file(s) parked behind ${payload.schema}.${payload.name}, which no longer exists`,
      );
      return;
    }
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
      await effects.failRefused(scope, url, index);
      return;
    case 'not_retried':
      // No rebuild ran on this pass: `path: null` keeps the audit row from
      // reporting a background rebuild that took 0 ms.
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
      await effects.failRefused(scope, url, index);
      return;
    case 'invalid':
      // Marked invalid by a failed CREATE/REINDEX CONCURRENTLY: nothing
      // rebuilds it on its own (the rebuild path refuses to touch it), so
      // this is a failed repair with an operator move, not a wait — and no
      // rebuild ran here either, hence `path: null`.
      refuseCorpusWrites(url, index.schema, { state: 'repair_failed', index });
      await effects.announce(
        scope,
        url,
        {
          kind: 'repair_failed',
          index,
          path: null,
          reindexMs: 0,
          reason: 'the index is marked invalid',
          error: `the index is marked invalid — drop it (DROP INDEX CONCURRENTLY ${indexName(index)}) and let the next scan rebuild the original`,
        },
        stamp,
      );
      await effects.failRefused(scope, url, index);
      return;
    case 'unverifiable':
      // The verification itself could not run (a restarting database, a
      // missing extension function) — nothing is known about the index, so
      // the refusal stays and the rebuild is tried again later rather than
      // dropped with the files still parked.
      logger.warn(
        `${labelFor(scope)}: could not verify ${indexName(index)} — rebuild re-scheduled in ${UNVERIFIABLE_RETRY_MS / 60_000} min: ${outcome.reason}`,
      );
      await effects.scheduleRebuild(scope, index, {
        delayMs: UNVERIFIABLE_RETRY_MS,
      });
      return;
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
    async scheduleRebuild(scope, index, options = {}) {
      const orgSlug = scope.kind === 'org' ? scope.orgSlug : null;
      await addJobInTx(
        sql,
        'knowledge.reindex_bm25',
        { orgSlug, schema: index.schema, name: index.name },
        {
          // One queued rebuild per (database, index): a concurrently booting
          // api and worker both defer the same index.
          singletonKey: `${orgSlug ?? 'default'}:${indexName(index)}`,
          ...(options.delayMs !== undefined
            ? { startAfter: new Date(Date.now() + options.delayMs) }
            : {}),
        },
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
    async failRefused(scope, url, index) {
      const orgs = await affectedOrganizations(sql, scope, url);
      return failRefusedFiles(
        sql,
        orgs.map((org) => org.id),
        index,
      );
    },
    async resumeRefused(url) {
      const orgs = await organizationsOnDatabase(sql, url);
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
  return organizationsOnDatabase(sql, url);
}

/** Every organization whose corpus resolves to `url` — bring-your-own or
 * the deployment default alike — by the resolver the pool routes through. */
async function organizationsOnDatabase(
  sql: Sql,
  url: string,
): Promise<{ id: string; slug: string }[]> {
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

/** The codes a file parks under while its corpus's index is bad: refused
 * during a rebuild, or after a failed one. A healthy index resumes both —
 * a repair the job could not do, an operator may have. */
const PARKED_BY_INDEX = [
  RAG_ERROR_INDEX_REBUILDING,
  RAG_ERROR_INDEX_REPAIR_FAILED,
] as const;

/**
 * Re-queue every file whose indexing was refused because the index was bad,
 * in id order, a bounded batch per transaction, until none is left. Clearing
 * the code in the same UPDATE is what makes the loop terminate; the hint
 * refreshes the document lists already showing the parked rows.
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
           WHERE rag_error_code = ANY(${[...PARKED_BY_INDEX]})
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

/**
 * Re-stamp the files parked as "being rebuilt — resumes automatically" once
 * the rebuild is known to have failed: the operator prose and code the
 * failed-indexing dialog branches on, and a hint so the lists showing the
 * old note refresh. One statement — a stamp change, not a claim.
 */
async function failRefusedFiles(
  sql: Sql,
  orgIds: readonly string[],
  index: Bm25Index,
): Promise<number> {
  if (orgIds.length === 0) return 0;
  return sql.begin(async (tx) => {
    const rows = await tx<{ orgId: string }[]>`
      UPDATE app.file_metadata
         SET rag_error = ${indexUnavailableMessage('repair_failed', indexName(index))},
             rag_error_code = ${RAG_ERROR_INDEX_REPAIR_FAILED}
       WHERE rag_error_code = ${RAG_ERROR_INDEX_REBUILDING}
         AND org_id = ANY(${[...orgIds]})
      RETURNING org_id AS "orgId"
    `;
    for (const orgId of new Set(rows.map((row) => row.orgId))) {
      await emitHintInTx(tx, { orgId, entity: 'document', entityId: null });
    }
    return rows.length;
  });
}
