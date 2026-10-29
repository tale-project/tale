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
 *    after it settled;
 *  - the failed rows are read in rotation: with more settled failures than a
 *    tick reads queued ahead of it, a false failure — a failed row whose
 *    corpus row completed — is adopted within two ticks, the stamps that
 *    rotate the batch move no settled row's status clock and tell no list,
 *    and a file parked while the search index rebuilds is never read;
 *  - a failure the tick writes itself carries no code: the interrupted text
 *    on a retried row that kept its previous failure's code, and a corpus
 *    copy on a row without one. A row the app classified keeps its sentence
 *    and code whatever its corpus copy says: a lost retry fails with it, a
 *    failed row stays as it is;
 *  - a retry queued while a tick is held between its read and its writes
 *    stands: no write of that tick lands on a row queued again since it was
 *    read, and a row nobody queued again is settled by the same tick.
 *
 * Each on organizations of its own. The candidate read is global, so the
 * rows here are queued before the epoch (negative queue times) and lead
 * every batch, whatever other rows the database holds. For the same reason
 * every tick here must be the only sweep running: the harness takes the
 * sweep's own clock off, and the first check reads that it is off.
 */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import {
  getKnowledgePoolForOrg,
  PRIVATE_KNOWLEDGE_SCHEMA,
} from '../../core/knowledge/pool.ts';
import { errorText, withinDeadline } from '../../integration-lane-helpers.ts';
import { markRagQueued } from '../knowledge/service.ts';
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
  await checkNoScheduledSweep(sql, record);
  await checkSettledFailures(sql, record);
  await checkHeldRowLock(sql, record);
  await checkFailedRotation(sql, record);
  await checkErrorCodePairs(sql, record);
  await checkRetryDuringTick(sql, record);
}

/**
 * The checks below count what their own ticks did, so no other sweep may run
 * beside them: one the job runner starts reads the same rows, which lead its
 * batch too. The harness takes the `watchdog.rag_indexing` clock off at boot.
 * Its tick in the 2-59/5 slot once queued behind the row the lock check
 * holds, and failed it as soon as the check let go, before the check read
 * back the row its own tick had deferred (#4113). A clock that comes back
 * fails here by name, not as a row another sweep settled. pg-boss's tables
 * are internal; these reads are pinned to v12 like the harness's own.
 */
async function checkNoScheduledSweep(sql: Sql, record: Record): Promise<void> {
  const [clock] = await sql<{ schedules: string; ticks: string }[]>`
    SELECT
      (SELECT count(*) FROM pgboss.schedule
        WHERE name = 'watchdog.rag_indexing')::text AS schedules,
      (SELECT count(*) FROM pgboss.job
        WHERE name = 'watchdog.rag_indexing'
          AND state IN ('created', 'retry', 'active'))::text AS ticks
  `;
  record(
    'rag watchdog: no scheduled sweep runs beside the ticks these checks count',
    clock?.schedules === '0' && clock.ticks === '0',
    `watchdog.rag_indexing schedules=${clock?.schedules} (want 0), queued or running ticks=${clock?.ticks} (want 0)`,
  );
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
    let holderPid = -1;
    holder = sql.begin(async (tx) => {
      const [self] = await tx<{ pid: number }[]>`
        SELECT pg_backend_pid() AS pid
      `;
      holderPid = self?.pid ?? -1;
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
    // Nothing may wait on the row once the tick is back: a write left queued
    // behind the lock lands as soon as the lock is let go, and the read below
    // would race it.
    const [waiting] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM pg_stat_activity
      WHERE ${holderPid}::int = ANY(pg_blocking_pids(pid))
    `;
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
        waiting?.count === '0' &&
        statusOf('first.pdf') === 'failed' &&
        statusOf('locked.pdf') === 'running' &&
        statusOf('after.pdf') === 'failed',
      `returned while the lock was held=${returned} after ${elapsedMs} ms (want < 10000), still waiting on the lock=${waiting?.count} (want 0), first=${statusOf('first.pdf')} locked=${statusOf('locked.pdf')} (want running) after=${statusOf('after.pdf')}, tick=${JSON.stringify(outcome)}`,
    );
  } finally {
    release();
    await holder.catch((error: unknown) => {
      console.warn('[itest] rag watchdog lock holder failed:', error);
    });
    await removeOrganizations(sql, [org]);
  }
}

async function checkFailedRotation(sql: Sql, record: Record): Promise<void> {
  const org = await insertOrganization(sql, 'rotation');
  const failedAt = Date.now() - 60_000;
  const queuedBefore = -Date.now();
  try {
    // More settled failures than a tick reads, all queued before the false
    // failure below: a batch read by queue time holds none but them.
    const settled = await sql<{ id: string; ref: string }[]>`
      INSERT INTO app.file_metadata (
        org_id, storage_ref, file_name, content_type, size, rag_status,
        rag_error, rag_queued_at_ms, status_changed_at_ms, created_at_ms
      )
      SELECT ${org.id},
             ${`s3:itest/${org.slug}/settled-`}::text || i,
             'settled-' || i || '.pdf', 'application/pdf', 1, 'failed',
             ${SETTLED_ERROR}, ${queuedBefore - 10_000}::bigint + i,
             ${failedAt}::bigint, ${failedAt}::bigint
      FROM generate_series(1, ${SETTLED_ROWS}) AS i
      RETURNING id, storage_ref AS ref
    `;
    const pool = await getKnowledgePoolForOrg(org.slug);
    await pool.unsafe(
      `INSERT INTO ${PRIVATE_KNOWLEDGE_SCHEMA}.documents
         (org_slug, file_id, filename, status, error)
       SELECT $1, ref, 'settled.pdf', 'failed', $3
       FROM unnest($2::text[]) AS ref`,
      [org.slug, settled.map((row) => row.ref), SETTLED_ERROR],
    );
    for (const index of [0, 100, SETTLED_ROWS - 1]) {
      const row = settled[index];
      if (row !== undefined) await holdByDocument(sql, org.id, row.ref);
    }
    // The false failure: its corpus row completed after all, and a listed
    // document holds it. Queued after every settled row.
    const falseRef = `s3:itest/${org.slug}/false-failure`;
    const [falseFailure] = await sql<{ id: string }[]>`
      INSERT INTO app.file_metadata (
        org_id, storage_ref, file_name, content_type, size, rag_status,
        rag_error, rag_queued_at_ms, status_changed_at_ms, created_at_ms
      ) VALUES (
        ${org.id}, ${falseRef}, 'false-failure.pdf', 'application/pdf', 1,
        'failed', ${RAG_INTERRUPTED_MESSAGE}, ${queuedBefore - 5_000},
        ${failedAt}, ${failedAt}
      )
      RETURNING id
    `;
    await pool.unsafe(
      `INSERT INTO ${PRIVATE_KNOWLEDGE_SCHEMA}.documents
         (org_slug, file_id, filename, status)
       VALUES ($1, $2, 'false-failure.pdf', 'completed')`,
      [org.slug, falseRef],
    );
    await holdByDocument(sql, org.id, falseRef);
    // A file parked while the corpus's index rebuilds, queued ahead of all of
    // them: index health re-queues it, and the sweep never reads, nor stamps,
    // it.
    const parkedRef = `s3:itest/${org.slug}/parked`;
    const [parked] = await sql<{ id: string }[]>`
      INSERT INTO app.file_metadata (
        org_id, storage_ref, file_name, content_type, size, rag_status,
        rag_error, rag_error_code, rag_queued_at_ms, status_changed_at_ms,
        created_at_ms
      ) VALUES (
        ${org.id}, ${parkedRef}, 'parked.pdf', 'application/pdf', 1,
        'failed', 'The search index is being rebuilt.', 'index_rebuilding',
        ${queuedBefore - 20_000}, ${failedAt}, ${failedAt}
      )
      RETURNING id
    `;
    await pool.unsafe(
      `INSERT INTO ${PRIVATE_KNOWLEDGE_SCHEMA}.documents
         (org_slug, file_id, filename, status, error)
       VALUES ($1, $2, 'parked.pdf', 'failed', 'The search index is being rebuilt.')`,
      [org.slug, parkedRef],
    );

    const tail = await outboxTail(sql);
    const statusOf = async (): Promise<string | null | undefined> => {
      const [row] = await sql<{ status: string | null }[]>`
        SELECT rag_status AS status FROM app.file_metadata
        WHERE id = ${falseFailure?.id ?? ''}
      `;
      return row?.status;
    };
    const ticks: string[] = [];
    let adoptedAfter: number | null = null;
    for (let tick = 1; tick <= 3 && adoptedAfter === null; tick += 1) {
      ticks.push(JSON.stringify(await recoverStuckRagIndexing(sql)));
      if ((await statusOf()) === 'completed') adoptedAfter = tick;
    }
    record(
      `rag watchdog: a false failure queued after ${SETTLED_ROWS} settled failures is adopted within two ticks`,
      adoptedAfter !== null && adoptedAfter <= 2,
      `adopted after tick ${adoptedAfter ?? 'none of 3'} (want ≤ 2), ticks=${ticks.join(' ')}`,
    );

    const [kept] = await sql<
      { kept: string; stamped: string; total: string }[]
    >`
      SELECT count(*) FILTER (
               WHERE rag_status = 'failed' AND rag_error = ${SETTLED_ERROR}
                 AND status_changed_at_ms = ${failedAt}
             )::text AS kept,
             count(*) FILTER (
               WHERE rag_reconciled_at_ms IS NOT NULL
             )::text AS stamped,
             count(*)::text AS total
      FROM app.file_metadata
      WHERE org_id = ${org.id}
        AND id <> ALL(${[falseFailure?.id ?? '', parked?.id ?? '']})
    `;
    const hints = await documentHintsSince(sql, tail, org.id);
    const [parkedAfter] = await sql<{ stamp: string | null }[]>`
      SELECT rag_reconciled_at_ms::text AS stamp FROM app.file_metadata
      WHERE id = ${parked?.id ?? ''}
    `;
    const parkedStamp =
      parkedAfter === undefined ? 'missing' : parkedAfter.stamp;
    record(
      'rag watchdog: the rotation stamps move no settled row’s status clock and tell no list, and a file parked by a bad search index is never read',
      kept?.kept === String(SETTLED_ROWS) &&
        kept.stamped === String(SETTLED_ROWS) &&
        parkedStamp === null &&
        hints === 1,
      `unchanged=${kept?.kept}/${kept?.total} (want ${SETTLED_ROWS}), stamped=${kept?.stamped} (want ${SETTLED_ROWS}), document hints=${hints} (want 1: the adoption), parked row stamped=${String(parkedStamp)} (want null: left to index health)`,
    );
  } finally {
    await removeOrganizations(sql, [org]);
  }
}

const NO_MODEL_ERROR =
  'No embedding model is configured for this organization. An admin can set one under Settings → Data residency → Embedding model, then retry indexing.';
const UPSTREAM_ERROR =
  'The embedding provider could not serve the call; indexing is retried automatically.';

async function checkErrorCodePairs(sql: Sql, record: Record): Promise<void> {
  const org = await insertOrganization(sql, 'codes');
  const failedAt = Date.now() - 60_000;
  const queuedBefore = -Date.now();
  try {
    // Three rows Retry indexing re-queued after a failure for want of an
    // embedding model — `markRagQueued` kept that failure's sentence and code
    // — whose jobs were lost before pickup: one the corpus never saw, one
    // whose corpus row reads the same sentence (the shape the failure's own
    // upsert leaves), and one whose corpus row reads an earlier attempt's.
    // A running row with no pair whose corpus row failed. And a failed row
    // the app classified, whose corpus copy of the sentence is an earlier
    // attempt's.
    const names = [
      'lost.pdf',
      'copied.pdf',
      'stale-copy.pdf',
      'classified.pdf',
    ];
    const statuses = ['queued', 'queued', 'queued', 'failed'];
    const errors = [
      NO_MODEL_ERROR,
      NO_MODEL_ERROR,
      NO_MODEL_ERROR,
      UPSTREAM_ERROR,
    ];
    const codes = [
      'embedding_not_configured',
      'embedding_not_configured',
      'embedding_not_configured',
      'embedding_upstream',
    ];
    await sql`
      INSERT INTO app.file_metadata (
        org_id, storage_ref, file_name, content_type, size, rag_status,
        rag_error, rag_error_code, rag_queued_at_ms, status_changed_at_ms,
        created_at_ms
      )
      SELECT ${org.id}, ${`s3:itest/${org.slug}/`}::text || name, name,
             'application/pdf', 1, status, error, code,
             ${queuedBefore}::bigint + i, ${failedAt}::bigint,
             ${failedAt}::bigint
      FROM unnest(${names}::text[], ${statuses}::text[], ${errors}::text[],
                  ${codes}::text[])
           WITH ORDINALITY AS t(name, status, error, code, i)
    `;
    await sql`
      INSERT INTO app.file_metadata (
        org_id, storage_ref, file_name, content_type, size, rag_status,
        rag_queued_at_ms, created_at_ms
      ) VALUES (
        ${org.id}, ${`s3:itest/${org.slug}/codeless.pdf`}, 'codeless.pdf',
        'application/pdf', 1, 'running', ${queuedBefore}, ${failedAt}
      )
    `;
    const pool = await getKnowledgePoolForOrg(org.slug);
    const refOf = (name: string) => `s3:itest/${org.slug}/${name}`;
    await pool.unsafe(
      `INSERT INTO ${PRIVATE_KNOWLEDGE_SCHEMA}.documents
         (org_slug, file_id, filename, status, error)
       SELECT $1, file_id, 'moved.pdf', 'failed', error
       FROM unnest($2::text[], $3::text[]) AS t(file_id, error)`,
      [
        org.slug,
        [
          refOf('copied.pdf'),
          refOf('stale-copy.pdf'),
          refOf('codeless.pdf'),
          refOf('classified.pdf'),
        ],
        [NO_MODEL_ERROR, CORPUS_ERROR, CORPUS_ERROR, SETTLED_ERROR],
      ],
    );

    const tick = await recoverStuckRagIndexing(sql);
    const after = await sql<
      {
        name: string;
        status: string | null;
        error: string | null;
        code: string | null;
      }[]
    >`
      SELECT file_name AS name, rag_status AS status, rag_error AS error,
             rag_error_code AS code
      FROM app.file_metadata WHERE org_id = ${org.id}
    `;
    const rowOf = (name: string) => after.find((row) => row.name === name);
    const lost = rowOf('lost.pdf');
    const codeless = rowOf('codeless.pdf');
    record(
      'rag watchdog: a failure it writes itself carries no code — a retried row’s previous code never stays under the interrupted text, and a corpus copy goes on a row without one',
      lost?.status === 'failed' &&
        lost.error === RAG_INTERRUPTED_MESSAGE &&
        lost.code === null &&
        codeless?.status === 'failed' &&
        codeless.error === CORPUS_ERROR &&
        codeless.code === null,
      `lost=${lost?.status}/${lost?.code} (want failed, interrupted text: ${lost?.error === RAG_INTERRUPTED_MESSAGE}, no code), codeless=${codeless?.status}/${codeless?.code} (want failed, the corpus error: ${codeless?.error === CORPUS_ERROR}, no code), tick=${JSON.stringify(tick)}`,
    );
    const pairKept = (name: string, error: string, code: string) => {
      const row = rowOf(name);
      return (
        row?.status === 'failed' && row.error === error && row.code === code
      );
    };
    record(
      'rag watchdog: a row the app classified keeps its sentence and code whatever its corpus copy says — a lost retry fails with its pair, a failed row stays as it is',
      pairKept('copied.pdf', NO_MODEL_ERROR, 'embedding_not_configured') &&
        pairKept(
          'stale-copy.pdf',
          NO_MODEL_ERROR,
          'embedding_not_configured',
        ) &&
        pairKept('classified.pdf', UPSTREAM_ERROR, 'embedding_upstream'),
      ['copied.pdf', 'stale-copy.pdf', 'classified.pdf']
        .map((name) => {
          const row = rowOf(name);
          return `${name}=${row?.status}/${row?.code} (own sentence: ${row?.error === (name === 'classified.pdf' ? UPSTREAM_ERROR : NO_MODEL_ERROR)})`;
        })
        .join(', ') +
        ' (want failed with the pair it carried: embedding_not_configured, embedding_not_configured, embedding_upstream)',
    );
  } finally {
    await removeOrganizations(sql, [org]);
  }
}

/** Polls `ready` every 50 ms for up to `ms`; whether it came true. */
async function waitUntil(
  ready: () => Promise<boolean>,
  ms = 10_000,
): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await ready()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

/**
 * Retry indexing is offered on a queued or running row once it is as old as
 * the stale window, so a retry meets a tick on exactly the rows the tick
 * settles. Here a tick reads its batch and is then held between that read
 * and its writes: another transaction holds the corpus table, so the tick's
 * corpus read waits. Meanwhile Retry indexing's own write (`markRagQueued`)
 * queues four of the rows again, stamping each afresh and keeping a retried
 * row's sentence and code. A write matched by the id, or by that code,
 * adopted or failed a file its person had just queued again; each now lands
 * only on a row still as the tick read it. A row nobody queued again, whose
 * run was never stamped, is settled by the same tick. The tick stamps the
 * failed rows it read before it reads the corpus, so a failed row it leaves
 * as it is tells when the batch was read.
 */
async function checkRetryDuringTick(sql: Sql, record: Record): Promise<void> {
  const org = await insertOrganization(sql, 'retry');
  const failedAt = Date.now() - 60_000;
  const queuedBefore = -Date.now();
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let holder: Promise<unknown> = Promise.resolve();
  let tick: Promise<string> = Promise.resolve('not started');
  try {
    const refOf = (name: string) => `s3:itest/${org.slug}/${name}`;
    const insertRow = async (
      name: string,
      status: string,
      queuedAt: number | null,
      failure: { error: string; code: string | null } | null = null,
    ): Promise<string> => {
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO app.file_metadata (
          org_id, storage_ref, file_name, content_type, size, rag_status,
          rag_error, rag_error_code, rag_queued_at_ms, status_changed_at_ms,
          created_at_ms
        ) VALUES (
          ${org.id}, ${refOf(name)}, ${name}, 'application/pdf', 1, ${status},
          ${failure?.error ?? null}, ${failure?.code ?? null}, ${queuedAt},
          ${failedAt}, ${queuedAt ?? queuedBefore + 5}
        )
        RETURNING id
      `;
      return row?.id ?? '';
    };
    // Queued before the epoch, so they lead the tick's batch: one row for
    // each write the tick would send it — an adoption, the kept pair of a
    // retry whose job was lost, a corpus copy, the interrupted text.
    const retried = new Map<string, string>([
      [
        'adopted.pdf',
        await insertRow('adopted.pdf', 'running', queuedBefore + 1),
      ],
      [
        'kept.pdf',
        await insertRow('kept.pdf', 'queued', queuedBefore + 2, {
          error: NO_MODEL_ERROR,
          code: 'embedding_not_configured',
        }),
      ],
      [
        'copied.pdf',
        await insertRow('copied.pdf', 'running', queuedBefore + 3),
      ],
      ['dead.pdf', await insertRow('dead.pdf', 'queued', queuedBefore + 4)],
    ]);
    const unstamped = await insertRow('unstamped.pdf', 'running', null);
    const marker = await insertRow('marker.pdf', 'failed', queuedBefore + 6, {
      error: SETTLED_ERROR,
      code: null,
    });
    const pool = await getKnowledgePoolForOrg(org.slug);
    await pool.unsafe(
      `INSERT INTO ${PRIVATE_KNOWLEDGE_SCHEMA}.documents
         (org_slug, file_id, filename, status)
       VALUES ($1, $2, 'adopted.pdf', 'completed')`,
      [org.slug, refOf('adopted.pdf')],
    );
    await pool.unsafe(
      `INSERT INTO ${PRIVATE_KNOWLEDGE_SCHEMA}.documents
         (org_slug, file_id, filename, status, error)
       SELECT $1, ref, 'failed.pdf', 'failed', $3
       FROM unnest($2::text[]) AS ref`,
      [org.slug, [refOf('kept.pdf'), refOf('copied.pdf')], CORPUS_ERROR],
    );

    // Another transaction holds the corpus table until released: the tick's
    // corpus read, and so every write after it, waits for it.
    let taken = () => {};
    const lockTaken = new Promise<void>((resolve) => {
      taken = resolve;
    });
    let holderPid = -1;
    holder = pool.begin(async (tx) => {
      const [self] = await tx<{ pid: number }[]>`
        SELECT pg_backend_pid() AS pid
      `;
      holderPid = self?.pid ?? -1;
      await tx.unsafe(
        `LOCK TABLE ${PRIVATE_KNOWLEDGE_SCHEMA}.documents IN ACCESS EXCLUSIVE MODE`,
      );
      taken();
      await released;
    });
    await Promise.race([lockTaken, holder]);

    let tickReturned = false;
    tick = recoverStuckRagIndexing(sql)
      .then(
        (counts) => JSON.stringify(counts),
        (error: unknown) => `threw ${errorText(error)}`,
      )
      .finally(() => {
        tickReturned = true;
      });
    const readBatch = await waitUntil(async () => {
      const [row] = await sql<{ stamped: boolean }[]>`
        SELECT rag_reconciled_at_ms IS NOT NULL AS stamped
        FROM app.file_metadata WHERE id = ${marker}
      `;
      return row !== undefined && row.stamped;
    });
    const held = await waitUntil(async () => {
      const [row] = await pool.unsafe<{ count: string }[]>(
        `SELECT count(*)::text AS count FROM pg_stat_activity
          WHERE $1::int = ANY(pg_blocking_pids(pid))`,
        [holderPid],
      );
      return row !== undefined && row.count !== '0';
    });

    // Retry indexing, committed while the tick waits.
    for (const id of retried.values()) await markRagQueued(sql, id);
    const stamps = new Map(
      (
        await sql<{ id: string; stamp: string | null }[]>`
          SELECT id, rag_queued_at_ms::text AS stamp FROM app.file_metadata
          WHERE id = ANY(${[...retried.values()]})
        `
      ).map((row) => [row.id, row.stamp]),
    );
    const heldThroughRetries = !tickReturned;
    release();
    await holder;
    const outcome = await withinDeadline(
      tick,
      15_000,
      'the tick the corpus lock held',
    ).catch((error: unknown) => errorText(error));

    const after = await sql<
      {
        id: string;
        status: string | null;
        stamp: string | null;
        error: string | null;
        code: string | null;
      }[]
    >`
      SELECT id, rag_status AS status, rag_queued_at_ms::text AS stamp,
             rag_error AS error, rag_error_code AS code
      FROM app.file_metadata WHERE org_id = ${org.id}
    `;
    const rowOf = (id: string) => after.find((row) => row.id === id);
    const stood = [...retried].map(([name, id]) => {
      const row = rowOf(id);
      const stamp = stamps.get(id) ?? null;
      return {
        name,
        status: row?.status,
        ok: row?.status === 'queued' && stamp !== null && row.stamp === stamp,
      };
    });
    const kept = rowOf(retried.get('kept.pdf') ?? '');
    record(
      'rag watchdog: a retry queued while a tick is held between its read and its writes stands — no adoption, kept pair, corpus copy or interrupted text lands on it',
      readBatch &&
        held &&
        heldThroughRetries &&
        stood.every((entry) => entry.ok) &&
        kept?.error === NO_MODEL_ERROR &&
        kept.code === 'embedding_not_configured',
      `tick read its batch=${readBatch}, held by the corpus lock=${held}, still held when the retries committed=${heldThroughRetries}; ${stood.map((entry) => `${entry.name}=${entry.status} (retry's stamp kept: ${entry.ok})`).join(', ')} (want each queued under its retry's stamp), kept pair intact=${kept?.error === NO_MODEL_ERROR && kept.code === 'embedding_not_configured'}, tick=${outcome}`,
    );
    const settled = rowOf(unstamped);
    const left = rowOf(marker);
    record(
      'rag watchdog: the held tick still settles a row nobody queued again, one whose run was never stamped',
      settled?.status === 'failed' &&
        settled.error === RAG_INTERRUPTED_MESSAGE &&
        settled.code === null &&
        left?.status === 'failed' &&
        left.error === SETTLED_ERROR,
      `unstamped=${settled?.status} (want failed, with the interrupted text: ${settled?.error === RAG_INTERRUPTED_MESSAGE}, no code: ${settled?.code === null}), marker=${left?.status} (want failed, its error kept: ${left?.error === SETTLED_ERROR})`,
    );
  } finally {
    release();
    await holder.catch((error: unknown) => {
      console.warn('[itest] rag watchdog corpus lock holder failed:', error);
    });
    await withinDeadline(tick, 15_000, 'the tick the corpus lock held').catch(
      (error: unknown) => {
        console.warn('[itest] rag watchdog held tick never returned:', error);
      },
    );
    await removeOrganizations(sql, [org]);
  }
}
