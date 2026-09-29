/**
 * Real-Postgres proof of what one RAG watchdog tick reaches, and what it
 * leaves alone:
 *
 *  - more settled failures than a tick reads — failed rows that already read
 *    their corpus row's error, queued before a stale `running` row — hold no
 *    slot ahead of it: the stuck row is failed in one tick. Those rows are
 *    neither rewritten nor told to a list, tick after tick; a failed row
 *    whose corpus row has another error is corrected once, its status clock
 *    kept;
 *  - a row lock another transaction holds costs the tick its lock timeout
 *    and no more: the tick comes back with that row deferred and the row
 *    after it settled.
 *
 * Each on organizations of its own. The candidate read is global, so the
 * rows here are queued before the epoch (negative queue times) and lead
 * every batch, whatever other rows the database holds.
 */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import {
  getKnowledgePoolForOrg,
  PRIVATE_KNOWLEDGE_SCHEMA,
} from '../../core/knowledge/pool.ts';
import {
  RAG_INTERRUPTED_MESSAGE,
  recoverStuckRagIndexing,
} from './watchdogs.ts';

type Record = (name: string, ok: boolean, detail: string) => void;

/** One more settled failure than a tick reads (`RAG_MAX_PER_RUN`). */
const SETTLED_ROWS = 201;
const SETTLED_ERROR =
  'Indexing failed on the platform’s side; it is retried automatically, and the cause is in the platform log.';
const CORPUS_ERROR = 'The embedding server answered 503.';

export async function checkRagWatchdogBatch(
  sql: Sql,
  record: Record,
): Promise<void> {
  await checkSettledFailures(sql, record);
  await checkHeldRowLock(sql, record);
}

async function insertOrganization(
  sql: Sql,
  label: string,
): Promise<{ id: string; slug: string }> {
  const id = randomUUID();
  const slug = `itest-rag-${label}-${id.slice(0, 8)}`;
  await sql`
    INSERT INTO "organization" ("id", "name", "slug", "createdAt")
    VALUES (${id}, ${`RAG watchdog ${label}`}, ${slug}, now())
  `;
  return { id, slug };
}

async function holdByDocument(
  sql: Sql,
  orgId: string,
  ref: string,
): Promise<void> {
  await sql`
    INSERT INTO app.documents (
      org_id, title, file_ref, extension, source_provider, created_by,
      created_at_ms, updated_at_ms
    ) VALUES (
      ${orgId}, 'report.pdf', ${ref}, 'pdf', 'upload', 'itest:rag-watchdog',
      ${Date.now()}, ${Date.now()}
    )
  `;
}

/** The outbox's newest id: hints after it are the ones a tick emitted. */
async function outboxTail(sql: Sql): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    SELECT coalesce(max(id), 0)::text AS id FROM app_realtime.outbox
  `;
  return rows[0]?.id ?? '0';
}

async function documentHintsSince(
  sql: Sql,
  tail: string,
  orgId: string,
): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app_realtime.outbox
    WHERE id > ${tail}::bigint AND org_id = ${orgId} AND entity = 'document'
  `;
  return Number(rows[0]?.count ?? '-1');
}

async function removeOrganizations(
  sql: Sql,
  orgs: readonly { id: string; slug: string }[],
): Promise<void> {
  for (const org of orgs) {
    await sql`DELETE FROM app.documents WHERE org_id = ${org.id}`;
    await sql`DELETE FROM app.file_metadata WHERE org_id = ${org.id}`;
    const pool = await getKnowledgePoolForOrg(org.slug);
    await pool
      .unsafe(
        `DELETE FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.documents WHERE org_slug = $1`,
        [org.slug],
      )
      .catch((error: unknown) => {
        console.warn('[itest] rag watchdog corpus cleanup failed:', error);
      });
    await sql`DELETE FROM "organization" WHERE "id" = ${org.id}`;
  }
}

async function checkSettledFailures(sql: Sql, record: Record): Promise<void> {
  const settledOrg = await insertOrganization(sql, 'settled');
  const correctedOrg = await insertOrganization(sql, 'corrected');
  // Every row failed a minute ago, well inside the window the sweep watches
  // failed rows for.
  const failedAt = Date.now() - 60_000;
  const queuedBefore = -Date.now();
  try {
    // The job failure's shape: the same sentence on the file row and on the
    // corpus row. Queued before the stuck row below, so a batch ranked by
    // queue time alone is full of them before it reaches that row.
    const settled = await sql<{ id: string; ref: string }[]>`
      INSERT INTO app.file_metadata (
        org_id, storage_ref, file_name, content_type, size, rag_status,
        rag_error, rag_queued_at_ms, status_changed_at_ms, created_at_ms
      )
      SELECT ${settledOrg.id},
             ${`s3:itest/${settledOrg.slug}/settled-`}::text || i,
             'settled-' || i || '.pdf', 'application/pdf', 1, 'failed',
             ${SETTLED_ERROR}, ${queuedBefore - 10_000}::bigint + i,
             ${failedAt}::bigint, ${failedAt}::bigint
      FROM generate_series(1, ${SETTLED_ROWS}) AS i
      RETURNING id, storage_ref AS ref
    `;
    const settledPool = await getKnowledgePoolForOrg(settledOrg.slug);
    await settledPool.unsafe(
      `INSERT INTO ${PRIVATE_KNOWLEDGE_SCHEMA}.documents
         (org_slug, file_id, filename, status, error)
       SELECT $1, ref, 'settled.pdf', 'failed', $3
       FROM unnest($2::text[]) AS ref`,
      [settledOrg.slug, settled.map((row) => row.ref), SETTLED_ERROR],
    );
    // A few of them are on a document list, the first and the last included.
    for (const index of [0, 100, SETTLED_ROWS - 1]) {
      const row = settled[index];
      if (row !== undefined) await holdByDocument(sql, settledOrg.id, row.ref);
    }
    // A stale chat attachment the corpus never saw: its chain is dead.
    const [stuck] = await sql<{ id: string }[]>`
      INSERT INTO app.file_metadata (
        org_id, storage_ref, file_name, content_type, size, rag_status,
        rag_queued_at_ms, created_at_ms
      ) VALUES (
        ${settledOrg.id}, ${`s3:itest/${settledOrg.slug}/stuck`}, 'stuck.pdf',
        'application/pdf', 1, 'running', ${queuedBefore}, ${failedAt}
      )
      RETURNING id
    `;
    // A listed failed row whose corpus row has learned the real error.
    const correctedRef = `s3:itest/${correctedOrg.slug}/corrected`;
    const [corrected] = await sql<{ id: string }[]>`
      INSERT INTO app.file_metadata (
        org_id, storage_ref, file_name, content_type, size, rag_status,
        rag_error, rag_queued_at_ms, status_changed_at_ms, created_at_ms
      ) VALUES (
        ${correctedOrg.id}, ${correctedRef}, 'corrected.pdf',
        'application/pdf', 1, 'failed', ${RAG_INTERRUPTED_MESSAGE},
        ${queuedBefore - 20_000}, ${failedAt}, ${failedAt}
      )
      RETURNING id
    `;
    const correctedPool = await getKnowledgePoolForOrg(correctedOrg.slug);
    await correctedPool.unsafe(
      `INSERT INTO ${PRIVATE_KNOWLEDGE_SCHEMA}.documents
         (org_slug, file_id, filename, status, error)
       VALUES ($1, $2, 'corrected.pdf', 'failed', $3)`,
      [correctedOrg.slug, correctedRef, CORPUS_ERROR],
    );
    await holdByDocument(sql, correctedOrg.id, correctedRef);

    const tail = await outboxTail(sql);
    const firstTick = await recoverStuckRagIndexing(sql);
    const [stuckAfter] = await sql<
      { status: string | null; error: string | null }[]
    >`
      SELECT rag_status AS status, rag_error AS error
      FROM app.file_metadata WHERE id = ${stuck?.id ?? ''}
    `;
    record(
      `rag watchdog: a stale running row is failed in one tick behind ${SETTLED_ROWS} settled failures queued before it`,
      settled.length === SETTLED_ROWS &&
        stuckAfter?.status === 'failed' &&
        stuckAfter.error === RAG_INTERRUPTED_MESSAGE,
      `stuck=${stuckAfter?.status} (want failed, with the interrupted text: ${stuckAfter?.error === RAG_INTERRUPTED_MESSAGE}), tick=${JSON.stringify(firstTick)}, settled rows=${settled.length}`,
    );

    // A second tick, with room for every one of them.
    await recoverStuckRagIndexing(sql, { limit: 1_000 });
    const [kept] = await sql<{ kept: string; total: string }[]>`
      SELECT count(*) FILTER (
               WHERE rag_status = 'failed' AND rag_error = ${SETTLED_ERROR}
                 AND status_changed_at_ms = ${failedAt}
             )::text AS kept,
             count(*)::text AS total
      FROM app.file_metadata
      WHERE org_id = ${settledOrg.id} AND id <> ${stuck?.id ?? ''}
    `;
    const settledHints = await documentHintsSince(sql, tail, settledOrg.id);
    record(
      'rag watchdog: a failed row that reads its corpus error is neither rewritten nor told to a list, tick after tick',
      kept?.kept === String(SETTLED_ROWS) &&
        kept.total === String(SETTLED_ROWS) &&
        settledHints === 0,
      `unchanged=${kept?.kept}/${kept?.total} (want ${SETTLED_ROWS}/${SETTLED_ROWS}), document hints=${settledHints} (want 0)`,
    );

    const [correctedAfter] = await sql<
      { error: string | null; changedAt: string | null }[]
    >`
      SELECT rag_error AS error, status_changed_at_ms::text AS "changedAt"
      FROM app.file_metadata WHERE id = ${corrected?.id ?? ''}
    `;
    const correctedHints = await documentHintsSince(sql, tail, correctedOrg.id);
    record(
      'rag watchdog: another corpus error corrects a failed row once, keeping its status clock',
      correctedAfter?.error === CORPUS_ERROR &&
        correctedAfter.changedAt === String(failedAt) &&
        correctedHints === 1,
      `error=${correctedAfter?.error} (want the corpus's), status clock kept=${correctedAfter?.changedAt === String(failedAt)}, document hints=${correctedHints} (want 1)`,
    );
  } finally {
    await removeOrganizations(sql, [settledOrg, correctedOrg]);
  }
}

async function checkHeldRowLock(sql: Sql, record: Record): Promise<void> {
  const org = await insertOrganization(sql, 'lock');
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let holder: Promise<unknown> = Promise.resolve();
  try {
    const names = ['first.pdf', 'locked.pdf', 'after.pdf'];
    const rows = await sql<{ id: string; name: string }[]>`
      INSERT INTO app.file_metadata (
        org_id, storage_ref, file_name, content_type, size, rag_status,
        rag_queued_at_ms, created_at_ms
      )
      SELECT ${org.id}, ${`s3:itest/${org.slug}/`}::text || name, name,
             'application/pdf', 1, 'running', ${-Date.now()}::bigint + i,
             ${Date.now()}::bigint
      FROM unnest(${names}::text[]) WITH ORDINALITY AS t(name, i)
      RETURNING id, file_name AS name
    `;
    const locked = rows.find((row) => row.name === 'locked.pdf');
    // Another transaction holds the middle row, as a document bind holds
    // its file row, and keeps holding it until released.
    let taken = () => {};
    const lockTaken = new Promise<void>((resolve) => {
      taken = resolve;
    });
    holder = sql.begin(async (tx) => {
      await tx`
        SELECT id FROM app.file_metadata WHERE id = ${locked?.id ?? ''}
        FOR UPDATE
      `;
      taken();
      await released;
    });
    await Promise.race([lockTaken, holder]);

    const started = Date.now();
    const sweep = recoverStuckRagIndexing(sql, { limit: rows.length });
    const returned = await Promise.race([
      sweep.then(() => true),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), 15_000);
      }),
    ]);
    const elapsedMs = Date.now() - started;
    release();
    await holder;
    const outcome = await sweep;
    const after = await sql<{ name: string; status: string | null }[]>`
      SELECT file_name AS name, rag_status AS status
      FROM app.file_metadata WHERE org_id = ${org.id}
    `;
    const statusOf = (name: string) =>
      after.find((row) => row.name === name)?.status;
    record(
      'rag watchdog: a row lock held past the settle lock timeout defers that row alone',
      returned &&
        elapsedMs < 10_000 &&
        statusOf('first.pdf') === 'failed' &&
        statusOf('locked.pdf') === 'running' &&
        statusOf('after.pdf') === 'failed',
      `returned while the lock was held=${returned} after ${elapsedMs} ms (want < 10000), first=${statusOf('first.pdf')} locked=${statusOf('locked.pdf')} (want running) after=${statusOf('after.pdf')}, tick=${JSON.stringify(outcome)}`,
    );
  } finally {
    release();
    await holder.catch((error: unknown) => {
      console.warn('[itest] rag watchdog lock holder failed:', error);
    });
    await removeOrganizations(sql, [org]);
  }
}
