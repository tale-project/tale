import type { TransactionSql } from 'postgres';

/**
 * Where a scheduled issue import resumes (migration 0140): the importers read
 * one bounded batch per call and answer an opaque `nextCursor` while open
 * issues remain, and an automation that must cover every open issue keeps
 * that cursor here between its occurrences — one batch per occurrence, from
 * where the last saved batch stopped, until the listing is drained. The
 * schedule is the clock; this module only remembers the position.
 *
 * A read hands out the stored cursor with the position's REVISION and counts
 * the attempt; a save advances the position only while the revision is still
 * the one its run read. The revision — never the cursor text — is the compare
 * token because the text repeats: every drain and every restart returns it to
 * empty, and a later pass can reach the same cursor again, so a delayed save
 * matched on text would skip the new pass's batch. Every transition takes a
 * fresh value of a sequence (a saved batch, a drain, a restart), so a revision
 * never repeats. So an import that failed — whose run saves nothing — retries
 * the same batch next occurrence; a save from any earlier revision (an
 * overlapping run, a delayed run of a completed pass, a stale end-of-list)
 * is refused and writes nothing; and a position the source keeps refusing is
 * dropped after {@link IMPORT_CURSOR_MAX_ATTEMPTS} reads without a save: the
 * next read starts the pass over rather than failing the same way forever.
 * Re-importing a batch is harmless — tasks are keyed by their source identity.
 *
 * Authorization is the caller's (`pgTaskStore`): these run inside the
 * transaction that already checked the automation run may write in the
 * project.
 */

/** Reads of a stored cursor without a save before the next read starts the
 * pass over. */
export const IMPORT_CURSOR_MAX_ATTEMPTS = 3;

export interface ImportCursorKey {
  organizationId: string;
  projectId: string;
  externalSystem: 'github' | 'glitchtip';
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

interface CursorRow {
  cursor: string | null;
  revision: string;
  batch: number;
  attempts: number;
  passStartedAt: number | null;
  lastDrainedAt: number | null;
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
           last_drained_at_ms::float8 AS "lastDrainedAt"
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

export async function readImportCursor(
  tx: TransactionSql,
  key: ImportCursorKey,
): Promise<ImportCursorRead> {
  const now = Date.now();
  const row = await lockCursorRow(tx, key, now);
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
  // An attempt is no transition: readers of one position share its
  // revision, and the first of them to save moves it on for the rest.
  await tx`
    UPDATE app.task_import_cursors SET
      attempts = attempts + 1, updated_at_ms = ${now}
    WHERE ${whereKey(tx, key)}
  `;
  return {
    cursor: row.cursor,
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
  if (args.next === '') {
    const drained = await tx<{ revision: string }[]>`
      UPDATE app.task_import_cursors SET
        next_cursor = NULL, batch = 0, attempts = 0,
        pass_started_at_ms = NULL, last_drained_at_ms = ${now},
        revision = nextval('app.task_import_cursor_revisions'),
        updated_at_ms = ${now}
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
      updated_at_ms = ${now}
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
