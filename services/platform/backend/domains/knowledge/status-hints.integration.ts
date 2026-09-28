/**
 * Real-Postgres proof that a RAG status write tells the document lists only
 * about a file a document holds, on the lanes that write the status past
 * `writeRagStatus`: the RAG watchdog's settle, the index-health re-stamp and
 * requeue, and the embedding requeue. A chat, task or email attachment is on
 * no list, so moving one tells no one; a listed row beside it tells its
 * organization once.
 *
 * On an organization of its own, so only these rows can hint for it. Every
 * lane runs twice: over attachments alone (no hint), then with a listed row
 * among them. A job a requeue queues may still run while the hints are
 * counted, and it can only add a listed row's hint — so the listed counts
 * are floors where a job is queued, exact where none is.
 */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import {
  getKnowledgePoolForOrg,
  PRIVATE_KNOWLEDGE_SCHEMA,
} from '../../core/knowledge/pool.ts';
import {
  RAG_ERROR_EMBEDDING_NOT_CONFIGURED,
  RAG_ERROR_INDEX_REBUILDING,
} from '../../core/knowledge/rag_error_codes.ts';
import { recoverStuckRagIndexing } from '../file_metadata/watchdogs.ts';
import { productionEffects } from './index-health.ts';
import { requeueEmbeddingBlockedDocuments } from './service.ts';
import { checkRagStatusHintBindingRace } from './status-hints-race.integration.ts';

const PK_INDEX = {
  schema: 'private_knowledge',
  name: 'idx_pk_chunks_bm25',
  sizeBytes: 1,
  valid: true,
};

export async function checkRagStatusHintScope(
  sql: Sql,
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  await checkRagStatusHintBindingRace(sql, record);
  const orgId = randomUUID();
  const tag = orgId.slice(0, 8);
  const orgSlug = `itest-hint-scope-${tag}`;
  await sql`
    INSERT INTO "organization" ("id", "name", "slug", "createdAt")
    VALUES (${orgId}, 'RAG status hint scope', ${orgSlug}, now())
  `;

  /** The outbox's newest id: hints after it are the ones a lane emitted. */
  const outboxTail = async () =>
    (
      await sql<{ id: string }[]>`
        SELECT coalesce(max(id), 0)::text AS id FROM app_realtime.outbox
      `
    )[0]?.id ?? '0';
  const documentHintsSince = async (tail: string) =>
    Number(
      (
        await sql<{ count: string }[]>`
          SELECT count(*)::text AS count FROM app_realtime.outbox
          WHERE id > ${tail}::bigint AND org_id = ${orgId}
            AND entity = 'document'
        `
      )[0]?.count ?? '-1',
    );
  const hintsOf = async (run: () => Promise<unknown>) => {
    const tail = await outboxTail();
    await run();
    return documentHintsSince(tail);
  };

  const fileIds: string[] = [];
  const fileRow = async (
    fileName: string,
    state: {
      ragStatus: string;
      ragErrorCode?: string;
      skipRagIndexing?: boolean;
      queuedAtMs?: number;
    },
  ) => {
    const ref = `s3:itest/hint-scope-${tag}/${randomUUID()}`;
    const rows = await sql<{ id: string }[]>`
      INSERT INTO app.file_metadata (
        org_id, storage_ref, file_name, content_type, size, rag_status,
        rag_error_code, skip_rag_indexing, rag_queued_at_ms, created_at_ms
      ) VALUES (
        ${orgId}, ${ref}, ${fileName}, 'application/octet-stream', 1,
        ${state.ragStatus}, ${state.ragErrorCode ?? null},
        ${state.skipRagIndexing ?? null}, ${state.queuedAtMs ?? null},
        ${Date.now()}
      )
      RETURNING id
    `;
    fileIds.push(rows[0]?.id ?? '');
    return { id: rows[0]?.id ?? '', ref };
  };
  const holdByDocument = async (ref: string, title: string) => {
    await sql`
      INSERT INTO app.documents (
        org_id, title, file_ref, extension, source_provider, created_by,
        created_at_ms, updated_at_ms
      ) VALUES (
        ${orgId}, ${title}, ${ref}, 'pdf', 'upload', 'itest:hint-scope',
        ${Date.now()}, ${Date.now()}
      )
    `;
  };

  // A corpus row that finished while its status write was lost is adopted;
  // without one, the stale row is failed as interrupted. Either write is
  // one the lists render, so a seed INSERT that fails on a corpus the
  // watchdog can still read leaves its row on the second path, which proves
  // the same. A corpus the harness cannot reach proves nothing: the
  // watchdog's own corpus lookup throws, it defers the whole organization
  // to its next tick, and the watchdog record below fails with no row
  // settled — the skipped seeds it counts say why.
  const pool = await getKnowledgePoolForOrg(orgSlug);
  let seedsSkipped = 0;
  const indexedInCorpus = async (ref: string) => {
    try {
      await pool.unsafe(
        `INSERT INTO ${PRIVATE_KNOWLEDGE_SCHEMA}.documents
           (org_slug, file_id, filename, status, updated_at)
         VALUES ($1, $2, 'hint-scope.pdf', 'completed', now())
         ON CONFLICT DO NOTHING`,
        [orgSlug, ref],
      );
    } catch (error) {
      seedsSkipped += 1;
      console.warn('[itest] hint-scope corpus seed skipped:', error);
    }
  };

  try {
    // ---- the watchdog ----------------------------------------------------
    // Queued in the epoch's first milliseconds: stale by any window, and the
    // oldest candidates of the sweep, so a limit keeps it to these rows.
    const staleAt = (queuedAtMs: number) => ({
      ragStatus: 'running',
      queuedAtMs,
    });
    const chatDone = await fileRow('chat-done.pdf', staleAt(1));
    await indexedInCorpus(chatDone.ref);
    await fileRow('task-dead.pdf', staleAt(2));
    const attachmentSweepHints = await hintsOf(() =>
      recoverStuckRagIndexing(sql, { limit: 2 }),
    );
    // Two listed rows adopted, one listed and one attachment failed as
    // interrupted — and the failed attachment above, now a recent failure
    // the sweep reconciles again.
    for (const [name, queuedAtMs] of [
      ['report-done.pdf', 3],
      ['minutes-done.pdf', 4],
    ] as const) {
      const done = await fileRow(name, staleAt(queuedAtMs));
      await indexedInCorpus(done.ref);
      await holdByDocument(done.ref, name);
    }
    const docDead = await fileRow('report-dead.pdf', staleAt(5));
    await holdByDocument(docDead.ref, 'report-dead.pdf');
    await fileRow('chat-dead.pdf', staleAt(6));
    const listedSweepHints = await hintsOf(() =>
      recoverStuckRagIndexing(sql, { limit: 5 }),
    );
    const settled = await sql<{ ragStatus: string | null }[]>`
      SELECT rag_status AS "ragStatus" FROM app.file_metadata
      WHERE org_id = ${orgId}
    `;
    record(
      'rag watchdog: settling an attachment tells no document list; listed rows tell their organization once',
      attachmentSweepHints === 0 &&
        listedSweepHints === 1 &&
        settled.length === 6 &&
        settled.every(
          (row) => row.ragStatus === 'completed' || row.ragStatus === 'failed',
        ),
      `attachments=${attachmentSweepHints} (want 0), with listed rows=${listedSweepHints} (want 1), settled=${settled.map((row) => row.ragStatus).join('/')} (want completed/failed ×6), corpus seeds skipped=${seedsSkipped}`,
    );

    // ---- index health: the re-stamp, then the requeue --------------------
    // Opted out of indexing, so the jobs the requeue queues end at once.
    const parked = {
      ragStatus: 'failed',
      ragErrorCode: RAG_ERROR_INDEX_REBUILDING,
      skipRagIndexing: true,
    };
    const orgScope = { kind: 'org', orgSlug } as const;
    const effects = productionEffects(sql);
    await fileRow('chat-parked.pdf', parked);
    await fileRow('mail-parked.pdf', parked);
    const attachmentRestampHints = await hintsOf(() =>
      effects.failRefused(orgScope, 'itest://hint-scope', PK_INDEX),
    );
    const attachmentRequeueHints = await hintsOf(() =>
      effects.requeueRefused(orgScope, 'itest://hint-scope'),
    );
    const listedParked = await fileRow('report-parked.pdf', parked);
    await holdByDocument(listedParked.ref, 'report-parked.pdf');
    await fileRow('task-parked.pdf', parked);
    const listedRestampHints = await hintsOf(() =>
      effects.failRefused(orgScope, 'itest://hint-scope', PK_INDEX),
    );
    const listedRequeueHints = await hintsOf(() =>
      effects.requeueRefused(orgScope, 'itest://hint-scope'),
    );
    record(
      'index health: re-stamping or re-queueing parked attachments tells no document list; a listed row tells its organization',
      attachmentRestampHints === 0 &&
        attachmentRequeueHints === 0 &&
        listedRestampHints === 1 &&
        listedRequeueHints === 1,
      `attachments: re-stamp=${attachmentRestampHints} requeue=${attachmentRequeueHints} (want 0/0), with a listed row: re-stamp=${listedRestampHints} requeue=${listedRequeueHints} (want 1/1)`,
    );

    // ---- the embedding requeue ------------------------------------------
    // A `.doc`: the job each requeue queues lands it on `unsupported` from
    // its name, with no bytes to fetch.
    const blocked = {
      ragStatus: 'failed',
      ragErrorCode: RAG_ERROR_EMBEDDING_NOT_CONFIGURED,
    };
    await fileRow('chat-minutes.doc', blocked);
    await fileRow('task-minutes.doc', blocked);
    let attachmentRequeued = -1;
    const attachmentEmbeddingHints = await hintsOf(async () => {
      ({ requeued: attachmentRequeued } =
        await requeueEmbeddingBlockedDocuments(sql, {
          organizationId: orgId,
        }));
    });
    const listedBlocked = await fileRow('board-minutes.doc', blocked);
    await holdByDocument(listedBlocked.ref, 'board-minutes.doc');
    await fileRow('mail-minutes.doc', blocked);
    let listedRequeued = -1;
    const listedEmbeddingHints = await hintsOf(async () => {
      ({ requeued: listedRequeued } = await requeueEmbeddingBlockedDocuments(
        sql,
        { organizationId: orgId },
      ));
    });
    record(
      'embedding requeue: re-queueing attachments tells no document list; a listed row tells its organization',
      attachmentRequeued === 2 &&
        attachmentEmbeddingHints === 0 &&
        listedRequeued === 2 &&
        // The listed row's own job may hint too before this is counted.
        listedEmbeddingHints >= 1,
      `attachments: requeued=${attachmentRequeued} (want 2) hints=${attachmentEmbeddingHints} (want 0), with a listed row: requeued=${listedRequeued} (want 2) hints=${listedEmbeddingHints} (want ≥1)`,
    );
  } finally {
    await sql`DELETE FROM app.documents WHERE org_id = ${orgId}`;
    await sql`DELETE FROM app.file_metadata WHERE id = ANY(${fileIds})`;
    await pool
      .unsafe(
        `DELETE FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.documents WHERE org_slug = $1`,
        [orgSlug],
      )
      .catch((error: unknown) => {
        console.warn('[itest] hint-scope corpus cleanup failed:', error);
      });
    await sql`DELETE FROM "organization" WHERE "id" = ${orgId}`;
  }
}
