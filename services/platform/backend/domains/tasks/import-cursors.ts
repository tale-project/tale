import type { TransactionSql } from 'postgres';

/**
 * The sync position store (migrations 0140, 0211): where the issue sync of
 * one project's source resumes between runs. A source's listing is read one
 * bounded batch at a time, answering an opaque `nextCursor` while open issues
 * remain, and the position keeps that cursor between runs — one batch per
 * run, from where the last saved batch stopped, until the listing is
 * drained; the run after that starts the next pass. The schedule is the
 * clock; this module only remembers the position. One row per organization,
 * project, source adapter (`github`, `github-security`, `forgejo`,
 * `glitchtip`, any slug a new adapter brings) and source name
 * (`owner/repo`).
 *
 * Two kinds of caller share the rows. The `task.sync_issues` step reads a
 * position without counting anything ({@link readSyncPosition}), and counts
 * a failure only when the source refused its batch ({@link failSyncPosition}).
 * A hand-built chain of steps reads with {@link readImportCursor}, which
 * counts the attempt at the read, because a chain whose import failed never
 * reaches its save. Either way a save advances the position only while the
 * REVISION is still the one its run read. The revision — never the cursor
 * text — is the compare token because the text repeats: every drain and
 * every restart returns it to empty, and a later pass can reach the same
 * cursor again, so a delayed save matched on text would skip the new pass's
 * batch. Every transition takes a fresh value of a sequence (a saved batch,
 * a drain, a restart), so a revision never repeats. So a batch that failed —
 * whose run saves nothing — is read again next run; a save from any earlier
 * revision (an overlapping run, a delayed run of a completed pass, a stale
 * end-of-list) is refused and writes nothing; and a position the source keeps
 * refusing is dropped after {@link IMPORT_CURSOR_MAX_ATTEMPTS} failed reads:
 * the next read starts the pass over rather than failing the same way
 * forever. Re-importing a batch is harmless — tasks are keyed by their source
 * identity.
 *
 * A tracker that rate-limits the sync names how long to wait; the wait is
 * kept on the position ({@link waitSyncPosition}, or with a save), so the
 * runs before it is over leave the tracker alone.
 *
 * Authorization is the caller's (`pgTaskStore`): these run inside the
 * transaction that already checked the automation run may write in the
 * project.
 */

/** Failed reads of a stored cursor before the next read starts the pass
 * over. */
export const IMPORT_CURSOR_MAX_ATTEMPTS = 3;

export interface ImportCursorKey {
  organizationId: string;
  projectId: string;
  /** The source adapter's slug — the tracker's name on the tasks it makes
   * (`github`, `github-security`, `forgejo`, `glitchtip`). */
  externalSystem: string;
  /** The caller's name for the listing, such as `owner/repo`. */
  source: string;
}

export interface ImportCursorRead {
  /** Where this batch starts: `''` for the first batch of a pass. */
  cursor: string;
  /** The position's compare token: hand it back to the save. Opaque; a new
   * one after every saved batch, drain and restart, never a repeated one. */
  revision: string;
  /** The batch this read hands out — 1 for the first of a pass. */
  batch: number;
  /** A pass was under way, and this batch continues it. */
  resumed: boolean;
  /** The stored position went {@link IMPORT_CURSOR_MAX_ATTEMPTS} reads
   * without a save and was dropped: this batch starts the pass over. */
  restarted: boolean;
  /** When the current pass saved its first batch (epoch ms). */
  passStartedAt: number | null;
  /** When a pass last reached the end of the listing (epoch ms). */
  lastDrainedAt: number | null;
}

export interface ImportCursorSave {
  /** The position moved — the batch counts. */
  saved: boolean;
  /** The listing was drained: the pass is complete, the next read starts a
   * new one. */
  drained: boolean;
  /** The batch just saved (its number in the pass), or the stored count
   * when nothing was saved. */
  batch: number;
  /** The position has moved since this run read it (another run saved,
   * drained or restarted it); nothing written. */
  conflict: boolean;
  /** The position's revision now: the new one after a save, the current one
   * after a conflict. */
  revision: string;
}

/** What {@link readSyncPosition} answers: a read, and the wait the tracker
 * asked for. */
export interface SyncPositionRead extends ImportCursorRead {
  /** Until when the tracker asked to be left alone (epoch ms); null when it
   * asked nothing, or the wait is over. */
  retryAfter: number | null;
}

interface CursorRow {
  cursor: string | null;
  revision: string;
  batch: number;
  attempts: number;
  passStartedAt: number | null;
  lastDrainedAt: number | null;
  retryAfter: number | null;
}

const whereKey = (tx: TransactionSql, key: ImportCursorKey) => tx`
  org_id = ${key.organizationId} AND project_id = ${key.projectId}
  AND external_system = ${key.externalSystem} AND source = ${key.source}
`;

/** The source's row, created empty on first use and locked for the rest of
 * the transaction. */
async function lockCursorRow(
  tx: TransactionSql,
  key: ImportCursorKey,
  now: number,
): Promise<CursorRow> {
  await tx`
    INSERT INTO app.task_import_cursors (
      org_id, project_id, external_system, source, updated_at_ms
    ) VALUES (
      ${key.organizationId}, ${key.projectId}, ${key.externalSystem},
      ${key.source}, ${now}
    )
    ON CONFLICT DO NOTHING
  `;
  const rows = await tx<CursorRow[]>`
    SELECT next_cursor AS "cursor", revision::text AS "revision", batch,
           attempts, pass_started_at_ms::float8 AS "passStartedAt",
           last_drained_at_ms::float8 AS "lastDrainedAt",
           retry_after_ms::float8 AS "retryAfter"
    FROM app.task_import_cursors
    WHERE ${whereKey(tx, key)}
    FOR UPDATE
  `;
  const row = rows[0];
  if (row === undefined) {
    throw new Error('import cursor row vanished inside its own transaction');
  }
  return row;
}

/** The position as a read hands it out: the stored one, or — once it failed
 * {@link IMPORT_CURSOR_MAX_ATTEMPTS} times — a fresh pass. */
async function readPosition(
  tx: TransactionSql,
  key: ImportCursorKey,
  row: CursorRow,
  now: number,
): Promise<ImportCursorRead | null> {
  if (row.cursor === null) {
    return {
      cursor: '',
      revision: row.revision,
      batch: 1,
      resumed: false,
      restarted: false,
      passStartedAt: null,
      lastDrainedAt: row.lastDrainedAt,
    };
  }
  if (row.attempts >= IMPORT_CURSOR_MAX_ATTEMPTS) {
    // A restart is a transition: a new revision, so a save still holding the
    // dropped position is refused even once the new pass reaches the same
    // cursor text.
    const restarted = await tx<{ revision: string }[]>`
      UPDATE app.task_import_cursors SET
        next_cursor = NULL, batch = 0, attempts = 0,
        pass_started_at_ms = NULL,
        revision = nextval('app.task_import_cursor_revisions'),
        updated_at_ms = ${now}
      WHERE ${whereKey(tx, key)}
      RETURNING revision::text AS "revision"
    `;
    return {
      cursor: '',
      revision: restarted[0]?.revision ?? row.revision,
      batch: 1,
      resumed: false,
      restarted: true,
      passStartedAt: null,
      lastDrainedAt: row.lastDrainedAt,
    };
  }
  return null;
}

export async function readImportCursor(
  tx: TransactionSql,
  key: ImportCursorKey,
): Promise<ImportCursorRead> {
  const now = Date.now();
  const row = await lockCursorRow(tx, key, now);
  const fresh = await readPosition(tx, key, row, now);
  if (fresh !== null) return fresh;
  // An attempt is no transition: readers of one position share its
  // revision, and the first of them to save moves it on for the rest.
  await tx`
    UPDATE app.task_import_cursors SET
      attempts = attempts + 1, updated_at_ms = ${now}
    WHERE ${whereKey(tx, key)}
  `;
  return {
    cursor: row.cursor ?? '',
    revision: row.revision,
    batch: row.batch + 1,
    resumed: true,
    restarted: false,
    passStartedAt: row.passStartedAt,
    lastDrainedAt: row.lastDrainedAt,
  };
}

export async function saveImportCursor(
  tx: TransactionSql,
  key: ImportCursorKey,
  args: {
    /** The revision the batch's read answered. */
    revision: string;
    /** The listing's `nextCursor`; `''` once it is drained. */
    next: string;
    /** Until when the tracker asked to be left alone (epoch ms). A save
     * without one keeps the wait the position has: a concurrent run, or a
     * hand-built chain, that met no rate limit does not undo one that did. A
     * wait that has passed is simply not honoured any more. */
    retryAfter?: number;
  },
): Promise<ImportCursorSave> {
  const now = Date.now();
  const row = await lockCursorRow(tx, key, now);
  if (row.revision !== args.revision) {
    return {
      saved: false,
      drained: false,
      batch: row.batch,
      conflict: true,
      revision: row.revision,
    };
  }
  const batch = row.batch + 1;
  const wait =
    args.retryAfter === undefined
      ? tx`retry_after_ms`
      : tx`GREATEST(COALESCE(retry_after_ms, 0), ${args.retryAfter})`;
  if (args.next === '') {
    const drained = await tx<{ revision: string }[]>`
      UPDATE app.task_import_cursors SET
        next_cursor = NULL, batch = 0, attempts = 0,
        pass_started_at_ms = NULL, last_drained_at_ms = ${now},
        revision = nextval('app.task_import_cursor_revisions'),
        retry_after_ms = ${wait}, updated_at_ms = ${now}
      WHERE ${whereKey(tx, key)}
      RETURNING revision::text AS "revision"
    `;
    return {
      saved: true,
      drained: true,
      batch,
      conflict: false,
      revision: drained[0]?.revision ?? row.revision,
    };
  }
  const advanced = await tx<{ revision: string }[]>`
    UPDATE app.task_import_cursors SET
      next_cursor = ${args.next}, batch = ${batch}, attempts = 0,
      pass_started_at_ms = COALESCE(pass_started_at_ms, ${now}),
      revision = nextval('app.task_import_cursor_revisions'),
      retry_after_ms = ${wait}, updated_at_ms = ${now}
    WHERE ${whereKey(tx, key)}
    RETURNING revision::text AS "revision"
  `;
  return {
    saved: true,
    drained: false,
    batch,
    conflict: false,
    revision: advanced[0]?.revision ?? row.revision,
  };
}

/**
 * Where the issue sync resumes a source: the stored position, or a fresh
 * pass once it failed {@link IMPORT_CURSOR_MAX_ATTEMPTS} times in a row. The
 * read itself counts nothing — the sync counts a failure only when the source
 * refused its batch ({@link failSyncPosition}), so a rate limit or a stopped
 * server never pushes a position toward its restart.
 */
export async function readSyncPosition(
  tx: TransactionSql,
  key: ImportCursorKey,
): Promise<SyncPositionRead> {
  const now = Date.now();
  const row = await lockCursorRow(tx, key, now);
  const retryAfter =
    row.retryAfter !== null && row.retryAfter > now ? row.retryAfter : null;
  const fresh = await readPosition(tx, key, row, now);
  if (fresh !== null) return { ...fresh, retryAfter };
  return {
    cursor: row.cursor ?? '',
    revision: row.revision,
    batch: row.batch + 1,
    resumed: true,
    restarted: false,
    passStartedAt: row.passStartedAt,
    lastDrainedAt: row.lastDrainedAt,
    retryAfter,
  };
}

/**
 * Count a batch the source refused. Only while the position is still at the
 * revision the failed run read: a position another run has moved on since
 * did not fail. Answers whether it counted.
 */
export async function failSyncPosition(
  tx: TransactionSql,
  key: ImportCursorKey,
  args: { revision: string },
): Promise<boolean> {
  const counted = await tx<{ attempts: number }[]>`
    UPDATE app.task_import_cursors SET
      attempts = attempts + 1, updated_at_ms = ${Date.now()}
    WHERE ${whereKey(tx, key)} AND revision = ${args.revision}
    RETURNING attempts
  `;
  return counted.length > 0;
}

/**
 * Start the source's pass over now — its stored cursor belongs to another
 * filter, so reading it again cannot succeed. A transition like any restart
 * (a new revision), and only from the revision the run read. Answers the
 * revision the position is at afterwards, and whether this call moved it.
 */
export async function restartSyncPosition(
  tx: TransactionSql,
  key: ImportCursorKey,
  args: { revision: string },
): Promise<{ restarted: boolean; revision: string }> {
  const now = Date.now();
  const row = await lockCursorRow(tx, key, now);
  if (row.revision !== args.revision) {
    return { restarted: false, revision: row.revision };
  }
  const restarted = await tx<{ revision: string }[]>`
    UPDATE app.task_import_cursors SET
      next_cursor = NULL, batch = 0, attempts = 0,
      pass_started_at_ms = NULL,
      revision = nextval('app.task_import_cursor_revisions'),
      updated_at_ms = ${now}
    WHERE ${whereKey(tx, key)}
    RETURNING revision::text AS "revision"
  `;
  return {
    restarted: true,
    revision: restarted[0]?.revision ?? row.revision,
  };
}

/**
 * Keep the wait a rate-limiting tracker asked for on the source's position,
 * whatever its revision: the wait is about the tracker, not about how far
 * the pass got. A longer wait already kept stands.
 */
export async function waitSyncPosition(
  tx: TransactionSql,
  key: ImportCursorKey,
  args: { retryAfter: number },
): Promise<void> {
  const now = Date.now();
  await lockCursorRow(tx, key, now);
  await tx`
    UPDATE app.task_import_cursors SET
      retry_after_ms = GREATEST(COALESCE(retry_after_ms, 0), ${args.retryAfter}),
      updated_at_ms = ${now}
    WHERE ${whereKey(tx, key)}
  `;
}
