import type { TransactionSql } from 'postgres';

/**
 * Where a scheduled issue import resumes (migration 0140): the importers read
 * one bounded batch per call and answer an opaque `nextCursor` while open
 * issues remain, and an automation that must cover every open issue keeps
 * that cursor here between its occurrences — one batch per occurrence, from
 * where the last saved batch stopped, until the listing is drained. The
 * schedule is the clock; this module only remembers the position.
 *
 * A read hands out the stored cursor and counts the attempt; a save advances
 * it, compare-and-set on the cursor its run read. So an import that failed —
 * whose run saves nothing — retries the same batch next occurrence, an
 * overlapping run cannot move a pass backwards, and a position the source
 * keeps refusing is dropped after {@link IMPORT_CURSOR_MAX_ATTEMPTS} reads
 * without a save: the next read starts the pass over rather than failing the
 * same way forever. Re-importing a batch is harmless — tasks are keyed by
 * their source identity.
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
  /** Another run moved the pass since this one read it; nothing written. */
  conflict: boolean;
}

interface CursorRow {
  cursor: string | null;
  batch: number;
  attempts: number;
  passStartedAt: number | null;
  lastDrainedAt: number | null;
}

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
    SELECT next_cursor AS "cursor", batch, attempts,
           pass_started_at_ms::float8 AS "passStartedAt",
           last_drained_at_ms::float8 AS "lastDrainedAt"
    FROM app.task_import_cursors
    WHERE org_id = ${key.organizationId} AND project_id = ${key.projectId}
      AND external_system = ${key.externalSystem} AND source = ${key.source}
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
      batch: 1,
      resumed: false,
      restarted: false,
      passStartedAt: null,
      lastDrainedAt: row.lastDrainedAt,
    };
  }
  if (row.attempts >= IMPORT_CURSOR_MAX_ATTEMPTS) {
    await tx`
      UPDATE app.task_import_cursors SET
        next_cursor = NULL, batch = 0, attempts = 0,
        pass_started_at_ms = NULL, updated_at_ms = ${now}
      WHERE org_id = ${key.organizationId} AND project_id = ${key.projectId}
        AND external_system = ${key.externalSystem} AND source = ${key.source}
    `;
    return {
      cursor: '',
      batch: 1,
      resumed: false,
      restarted: true,
      passStartedAt: null,
      lastDrainedAt: row.lastDrainedAt,
    };
  }
  await tx`
    UPDATE app.task_import_cursors SET
      attempts = attempts + 1, updated_at_ms = ${now}
    WHERE org_id = ${key.organizationId} AND project_id = ${key.projectId}
      AND external_system = ${key.externalSystem} AND source = ${key.source}
  `;
  return {
    cursor: row.cursor,
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
    /** The cursor the batch started at, as the read answered it. */
    from: string;
    /** The listing's `nextCursor`; `''` once it is drained. */
    next: string;
  },
): Promise<ImportCursorSave> {
  const now = Date.now();
  const row = await lockCursorRow(tx, key, now);
  if ((row.cursor ?? '') !== args.from) {
    return { saved: false, drained: false, batch: row.batch, conflict: true };
  }
  const batch = row.batch + 1;
  if (args.next === '') {
    await tx`
      UPDATE app.task_import_cursors SET
        next_cursor = NULL, batch = 0, attempts = 0,
        pass_started_at_ms = NULL, last_drained_at_ms = ${now},
        updated_at_ms = ${now}
      WHERE org_id = ${key.organizationId} AND project_id = ${key.projectId}
        AND external_system = ${key.externalSystem} AND source = ${key.source}
    `;
    return { saved: true, drained: true, batch, conflict: false };
  }
  await tx`
    UPDATE app.task_import_cursors SET
      next_cursor = ${args.next}, batch = ${batch}, attempts = 0,
      pass_started_at_ms = COALESCE(pass_started_at_ms, ${now}),
      updated_at_ms = ${now}
    WHERE org_id = ${key.organizationId} AND project_id = ${key.projectId}
      AND external_system = ${key.externalSystem} AND source = ${key.source}
  `;
  return { saved: true, drained: false, batch, conflict: false };
}
