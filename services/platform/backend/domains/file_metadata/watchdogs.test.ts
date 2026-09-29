// @vitest-environment node

/**
 * Unit lock for the RAG reconcile sweep's settle text: a dead chain is failed
 * with guidance that points at the Retry indexing button the failed badge
 * already carries — never at a re-upload, which the text once demanded even
 * though the blob is still stored and the retry re-ingests it. The corpus's
 * own error, when it has one, always wins over the generic text, and an
 * already-failed row is never overwritten with it. A failed row that already
 * reads the corpus's error is settled: nothing is written and no list is
 * told, and another text is corrected without moving the row's status clock
 * — unless the row's code says the app classified its failure, whose pair
 * outranks the corpus copy. Every failure the sweep writes clears the code,
 * so a retried row never keeps its previous failure's code under the sweep's
 * text. The stuck rows are read ahead of the failed ones, and the failed ones
 * in rotation: each failed row a tick reads is stamped, skipping locked rows,
 * and a stamp that fails stops nothing. Each organization's
 * document lists hear a sweep once, and only for rows a document holds. Every
 * write runs in a transaction of its own under a lock timeout, and a write
 * that throws defers its own row and no other: the rows after it are still
 * settled and told, only two faults in a row stop the organization, and no
 * fault in one organization, its slug read included, stops the sweep of the
 * organizations after it. The stale-window scan, the batch order, a real row
 * lock and the adopt/revive rules ride the real-Postgres probes in
 * `integration-check.ts` and `watchdogs.integration.ts`.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getKnowledgePoolForOrg } from '../../core/knowledge/pool.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { HELD_BY_DOCUMENT_SQL } from '../knowledge/status-hints.ts';
import {
  RAG_INTERRUPTED_MESSAGE,
  recoverStuckRagIndexing,
} from './watchdogs.ts';

vi.mock('../../core/knowledge/pool.ts', () => ({
  getKnowledgePoolForOrg: vi.fn(),
  PRIVATE_KNOWLEDGE_SCHEMA: 'private_knowledge',
}));
vi.mock('../../realtime/outbox.ts', () => ({
  emitHintInTx: vi.fn(() => Promise.resolve()),
}));

interface Statement {
  text: string;
  values: unknown[];
  /** The `sql.begin` the statement ran in, numbered; null outside one. */
  transaction: number | null;
}

interface Candidate {
  id: string;
  orgId: string;
  storageRef: string;
  ragStatus: string;
  ragError: string | null;
  ragErrorCode: string | null;
  /** A document holds the file, so a document list shows its status. */
  listed: boolean;
}

interface CorpusRow {
  file_id: string;
  status: string;
  error: string | null;
  updated_at: string | null;
}

/**
 * Scripted `sql`: the candidate read is a snapshot of the columns it
 * selects, while the ownership read sees the current state. A bind or deletion may land between that
 * snapshot and the status write, as the real-Postgres lane proves too. The
 * status write of each row in `failWrites` throws, as a lock timeout would,
 * the slug read of `failSlugFor` throws, as a dropped connection would, and
 * with `failStamp` so does the rotation stamp.
 * `begin` runs its body on a handle whose statements carry the
 * transaction's number; a throw in the body is the begin's, as a rolled-back
 * transaction's is.
 */
function fakeSql(
  candidates: Candidate[],
  options: {
    bindBeforeWrite?: string;
    deleteBeforeWrite?: string;
    failWrites?: readonly string[];
    failSlugFor?: string;
    failStamp?: boolean;
  } = {},
): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const current = new Map(candidates.map((row) => [row.id, { ...row }]));
  const answer = (text: string, values: unknown[]) => {
    if (text.startsWith('SELECT id,')) {
      // Only the columns the read selects: a field it does not ask for is
      // not on the row it gets back.
      const selected = new Set([
        'id',
        ...[...text.matchAll(/ AS "(\w+)"/g)].map((match) => match[1]),
      ]);
      return Promise.resolve(
        candidates.map((row) =>
          Object.fromEntries(
            Object.entries(row).filter(([column]) => selected.has(column)),
          ),
        ),
      );
    }
    if (isStampText(text)) {
      return options.failStamp === true
        ? Promise.reject(new Error('Connection terminated unexpectedly'))
        : Promise.resolve([]);
    }
    if (text.startsWith('UPDATE app.file_metadata')) {
      const id = candidates.find((row) => values.includes(row.id))?.id;
      if (id !== undefined && options.failWrites?.includes(id) === true) {
        return Promise.reject(
          new Error('canceling statement due to lock timeout'),
        );
      }
      const row = id === undefined ? undefined : current.get(id);
      if (row === undefined || row.id === options.deleteBeforeWrite) {
        if (id !== undefined) current.delete(id);
        return Promise.resolve([]);
      }
      if (row.id === options.bindBeforeWrite) row.listed = true;
      return Promise.resolve([{ id: row.id }]);
    }
    if (values.includes(HELD_BY_DOCUMENT_SQL)) {
      const ids = values.find(Array.isArray) ?? [];
      return Promise.resolve(
        [...current.values()].filter(
          (row) => ids.includes(row.id) && values.includes(row.orgId),
        ),
      );
    }
    if (text.includes('FROM "organization"')) {
      if (
        options.failSlugFor !== undefined &&
        values.includes(options.failSlugFor)
      ) {
        return Promise.reject(new Error('Connection terminated unexpectedly'));
      }
      return Promise.resolve([{ slug: 'acme' }]);
    }
    return Promise.resolve([]);
  };
  let transactions = 0;
  const handle =
    (transaction: number | null) =>
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?').replace(/\s+/g, ' ').trim();
      statements.push({ text, values, transaction });
      return answer(text, values);
    };
  const sql = Object.assign(handle(null), {
    unsafe: (raw: string) => raw,
    begin: async (body: (tx: unknown) => Promise<unknown>) => {
      transactions += 1;
      return body(handle(transactions));
    },
  });
  return { sql: sql as unknown as Sql, statements };
}

/** The per-org corpus pool: `unsafe` answers the scripted document rows. */
function corpusAnswering(rows: CorpusRow[]): void {
  const pool = { unsafe: vi.fn(() => Promise.resolve(rows)) };
  vi.mocked(getKnowledgePoolForOrg).mockResolvedValue(pool as unknown as Sql);
}

function candidate(
  id: string,
  ragStatus = 'running',
  over: Partial<Candidate> = {},
): Candidate {
  return {
    id,
    orgId: 'org_1',
    storageRef: `s3:${id}`,
    ragStatus,
    ragError: null,
    ragErrorCode: null,
    listed: true,
    ...over,
  };
}

/** The `rag_status = 'failed'` write that targets one file row. */
const failWriteFor = (
  statements: Statement[],
  id: string,
): Statement | undefined =>
  statements.find(
    (s) =>
      s.text.includes("UPDATE app.file_metadata SET rag_status = 'failed'") &&
      s.values.includes(id),
  );

/** The rotation stamp's statement: it moves no status. */
function isStampText(text: string): boolean {
  return text.startsWith(
    'UPDATE app.file_metadata SET rag_reconciled_at_ms = ?',
  );
}

/** Every status write the sweep sent, in order — the rotation stamp aside. */
const writesOf = (statements: Statement[]): Statement[] =>
  statements.filter(
    (s) =>
      s.text.startsWith('UPDATE app.file_metadata') && !isStampText(s.text),
  );

/** The rotation stamps the sweep sent. */
const stampsOf = (statements: Statement[]): Statement[] =>
  statements.filter((s) => isStampText(s.text));

/** The file rows the sweep told one organization's lists about: the ids its
 * ownership read after the writes asked for. */
const toldAbout = (statements: Statement[], orgId: string): unknown[] =>
  statements
    .filter(
      (s) =>
        s.values.includes(HELD_BY_DOCUMENT_SQL) && s.values.includes(orgId),
    )
    .flatMap((s) => s.values.find(Array.isArray) ?? []);

afterEach(() => {
  vi.clearAllMocks();
});

describe('recoverStuckRagIndexing — the interrupted text', () => {
  it('points at Retry indexing, never at a re-upload', () => {
    expect(RAG_INTERRUPTED_MESSAGE).toContain('Retry indexing');
    expect(RAG_INTERRUPTED_MESSAGE).not.toMatch(/re-?upload/i);
  });

  it('settles a never-ingested stale row with the Retry indexing guidance', async () => {
    const { sql, statements } = fakeSql([candidate('fm_1')]);
    corpusAnswering([]);

    const result = await recoverStuckRagIndexing(sql, { staleMs: 1000 });

    expect(result).toEqual({ adopted: 0, failed: 1, revived: 0 });
    const write = failWriteFor(statements, 'fm_1');
    expect(write?.values).toContain(RAG_INTERRUPTED_MESSAGE);
  });

  it('falls back to the guidance only when the corpus failed without an error', async () => {
    const { sql, statements } = fakeSql([
      candidate('fm_silent'),
      candidate('fm_loud'),
    ]);
    corpusAnswering([
      {
        file_id: 's3:fm_silent',
        status: 'failed',
        error: null,
        updated_at: null,
      },
      {
        file_id: 's3:fm_loud',
        status: 'failed',
        error: 'No text extractor exists for "loud.bin".',
        updated_at: null,
      },
    ]);

    const result = await recoverStuckRagIndexing(sql, { staleMs: 1000 });

    expect(result).toEqual({ adopted: 0, failed: 2, revived: 0 });
    expect(failWriteFor(statements, 'fm_silent')?.values).toContain(
      RAG_INTERRUPTED_MESSAGE,
    );
    // The corpus knows the REAL error; the generic text never replaces it.
    const loud = failWriteFor(statements, 'fm_loud');
    expect(loud?.values).toContain('No text extractor exists for "loud.bin".');
    expect(loud?.values).not.toContain(RAG_INTERRUPTED_MESSAGE);
    // Both settles nudge the organization's document lists — once.
    expect(vi.mocked(emitHintInTx)).toHaveBeenCalledTimes(1);
  });

  it('never overwrites an already-failed row with the generic text', async () => {
    const { sql, statements } = fakeSql([candidate('fm_failed', 'failed')]);
    corpusAnswering([]);

    const result = await recoverStuckRagIndexing(sql, { staleMs: 1000 });

    expect(result).toEqual({ adopted: 0, failed: 0, revived: 0 });
    expect(failWriteFor(statements, 'fm_failed')).toBeUndefined();
  });

  // A job failure records the same sentence on the file row and the corpus
  // row, so every such row reads the corpus's error from the start. A
  // rewrite moved its `status_changed_at_ms`, the clock of the failed
  // window: the row never left the window, and its lists refetched on every
  // tick.
  it.each([
    [
      'the corpus error',
      'The embedding server answered 503.',
      'The embedding server answered 503.',
    ],
    [
      'the interrupted text, the corpus having none',
      null,
      RAG_INTERRUPTED_MESSAGE,
    ],
  ])(
    'leaves a failed row alone that already reads %s: no write, no hint',
    async (_label, corpusError, ragError) => {
      const { sql, statements } = fakeSql([
        candidate('fm_settled', 'failed', { ragError }),
      ]);
      corpusAnswering([
        {
          file_id: 's3:fm_settled',
          status: 'failed',
          error: corpusError,
          updated_at: null,
        },
      ]);

      const result = await recoverStuckRagIndexing(sql, { staleMs: 1000 });

      expect(result).toEqual({ adopted: 0, failed: 0, revived: 0 });
      expect(writesOf(statements)).toEqual([]);
      expect(vi.mocked(emitHintInTx)).not.toHaveBeenCalled();
    },
  );

  // A secret scan's refusal records no error on the corpus row, while the
  // file row carries the refusal's sentence: the generic text would send
  // the person to a retry that meets the same refusal.
  it('keeps a failed row’s own error when its corpus row failed without one', async () => {
    const { sql, statements } = fakeSql([
      candidate('fm_refused', 'failed', {
        ragError: 'Indexing refused (secret-detected).',
      }),
    ]);
    corpusAnswering([
      {
        file_id: 's3:fm_refused',
        status: 'failed',
        error: null,
        updated_at: null,
      },
    ]);

    const result = await recoverStuckRagIndexing(sql, { staleMs: 1000 });

    expect(result).toEqual({ adopted: 0, failed: 0, revived: 0 });
    expect(writesOf(statements)).toEqual([]);
    expect(vi.mocked(emitHintInTx)).not.toHaveBeenCalled();
  });

  it('corrects an already-failed row to the corpus error, keeping its status clock and its count', async () => {
    const { sql, statements } = fakeSql([
      candidate('fm_known', 'failed', { ragError: RAG_INTERRUPTED_MESSAGE }),
    ]);
    corpusAnswering([
      {
        file_id: 's3:fm_known',
        status: 'failed',
        error: 'The embedding server answered 503.',
        updated_at: null,
      },
    ]);

    const result = await recoverStuckRagIndexing(sql, { staleMs: 1000 });

    // No new failure, and the status has not changed, so its clock stays
    // where it was — but the row now reads the real error, and the
    // organization's lists hear it.
    expect(result).toEqual({ adopted: 0, failed: 0, revived: 0 });
    const writes = writesOf(statements);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.values).toContain('The embedding server answered 503.');
    expect(writes[0]?.values).toContain('fm_known');
    expect(writes[0]?.text).not.toContain('status_changed_at_ms');
    // Only the failed row it read, still without a code: a retry may have
    // queued it, or failed it with a classified cause, since.
    expect(writes[0]?.text).toContain("AND rag_status = 'failed'");
    expect(writes[0]?.text).toContain('AND rag_error_code IS NULL');
    // The corpus copy carries no code, and the text never travels without
    // its pair.
    expect(writes[0]?.text).toContain('rag_error_code = NULL');
    expect(vi.mocked(emitHintInTx)).toHaveBeenCalledTimes(1);
  });

  // The app wrote the sentence and the code together; the corpus copy is
  // best-effort and can be an earlier attempt's sentence. Swapping in that
  // sentence under the app's code paired a cause with another's guidance.
  it('leaves a failed row the app classified alone when its corpus row has another error', async () => {
    const { sql, statements } = fakeSql([
      candidate('fm_classified', 'failed', {
        ragError:
          'The embedding provider could not serve the call; indexing is retried automatically.',
        ragErrorCode: 'embedding_upstream',
      }),
    ]);
    corpusAnswering([
      {
        file_id: 's3:fm_classified',
        status: 'failed',
        error: 'The embedding server answered 503.',
        updated_at: null,
      },
    ]);

    const result = await recoverStuckRagIndexing(sql, { staleMs: 1000 });

    expect(result).toEqual({ adopted: 0, failed: 0, revived: 0 });
    expect(writesOf(statements)).toEqual([]);
    expect(vi.mocked(emitHintInTx)).not.toHaveBeenCalled();
  });

  it('reads every stuck row ahead of the failed rows, and the failed rows in rotation', async () => {
    const { sql, statements } = fakeSql([]);
    corpusAnswering([]);

    await recoverStuckRagIndexing(sql);

    // One limit covers both kinds; ranked by queue time alone, two hundred
    // failed rows filled it ahead of a row that got stuck after them, and
    // the same two hundred settled failures filled it ahead of every other
    // failed row. The stuck tier keeps its queue order; the failed tier
    // reads the row read longest ago first, one not read yet counting as
    // read when its run was queued. The effect on a real batch is
    // `watchdogs.integration.ts`'s to prove.
    const read = statements.find((s) => s.text.startsWith('SELECT id,'));
    expect(read?.text).toMatch(
      /ORDER BY \(rag_status = 'failed'\), CASE WHEN rag_status = 'failed' THEN coalesce\(rag_reconciled_at_ms, rag_queued_at_ms, created_at_ms\) END, coalesce\(rag_queued_at_ms, created_at_ms\) LIMIT \?$/,
    );
  });

  // Index health re-queues a parked file under `FOR UPDATE SKIP LOCKED` and
  // stops at a short batch: a stamp holding the row's lock at that moment
  // would leave it parked until the next healthy report.
  it('leaves a file parked by a bad search index to the index health report', async () => {
    const { sql, statements } = fakeSql([]);
    corpusAnswering([]);

    await recoverStuckRagIndexing(sql);

    const read = statements.find((s) => s.text.startsWith('SELECT id,'));
    expect(read?.text).toContain(
      "OR (rag_status = 'failed' AND coalesce(status_changed_at_ms, created_at_ms) > ? AND (rag_error_code IS NULL OR rag_error_code <> ALL(?)))",
    );
    expect(read?.values).toContainEqual([
      'index_rebuilding',
      'index_repair_failed',
    ]);
  });
});

describe('recoverStuckRagIndexing — a failure keeps its code with its text', () => {
  const NO_MODEL =
    'No embedding model is configured for this organization. An admin can set one under Settings → Data residency → Embedding model, then retry indexing.';

  // A file failed for want of an embedding model, an admin set one, the user
  // pressed Retry indexing, and the job was lost before it started:
  // `markRagQueued` kept the old sentence and code on the queued row. The
  // sweep's sentence must not go out under that code — the failed dialog
  // showed the Settings link beneath "interrupted", and REST's `errorCode`
  // disagreed with its `error`.
  it('settles a retried row that kept embedding_not_configured as interrupted, without that code', async () => {
    const { sql, statements } = fakeSql([
      candidate('fm_retried', 'queued', {
        ragError: NO_MODEL,
        ragErrorCode: 'embedding_not_configured',
      }),
    ]);
    corpusAnswering([]);

    const result = await recoverStuckRagIndexing(sql, { staleMs: 1000 });

    expect(result).toEqual({ adopted: 0, failed: 1, revived: 0 });
    const writes = writesOf(statements);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toBe(failWriteFor(statements, 'fm_retried'));
    expect(writes[0]?.values).toContain(RAG_INTERRUPTED_MESSAGE);
    // The same statement clears the code: no later write could pair it again.
    expect(writes[0]?.text).toContain('rag_error_code = NULL');
    expect(writes[0]?.values).not.toContain('embedding_not_configured');
  });

  // The usual shape of that lost retry: `recordIndexingFailure` upserted
  // the corpus row as failed with the same sentence. Its copy carries no
  // code, but the row still carries the app's pair: failing the row with
  // the corpus's sentence and no code dropped the Settings link, and the
  // embedding save's re-queue, scoped by the code, passed the file over.
  it.each([
    ['the same sentence, as the failure recorded it', NO_MODEL],
    ['an earlier attempt’s sentence', 'The embedding server answered 503.'],
  ])(
    'fails a retried row with its own classified pair when its corpus row holds %s',
    async (_label, corpusError) => {
      const { sql, statements } = fakeSql([
        candidate('fm_retried', 'queued', {
          ragError: NO_MODEL,
          ragErrorCode: 'embedding_not_configured',
        }),
      ]);
      corpusAnswering([
        {
          file_id: 's3:fm_retried',
          status: 'failed',
          error: corpusError,
          updated_at: null,
        },
      ]);

      const result = await recoverStuckRagIndexing(sql, { staleMs: 1000 });

      expect(result).toEqual({ adopted: 0, failed: 1, revived: 0 });
      const writes = writesOf(statements);
      expect(writes).toHaveLength(1);
      // The status moves; the sentence and its code stay together as the app
      // wrote them — only while the row still carries that code.
      expect(writes[0]?.text).toMatch(
        /^UPDATE app\.file_metadata SET rag_status = 'failed', status_changed_at_ms = \? WHERE id = \? AND rag_error_code = \? RETURNING id$/,
      );
      expect(writes[0]?.values).toContain('embedding_not_configured');
      expect(writes[0]?.values).not.toContain(corpusError);
    },
  );

  it('settles a stuck row without a code with its corpus row’s error, and no code', async () => {
    const { sql, statements } = fakeSql([candidate('fm_codeless', 'running')]);
    corpusAnswering([
      {
        file_id: 's3:fm_codeless',
        status: 'failed',
        error: 'The embedding server answered 503.',
        updated_at: null,
      },
    ]);

    const result = await recoverStuckRagIndexing(sql, { staleMs: 1000 });

    expect(result).toEqual({ adopted: 0, failed: 1, revived: 0 });
    const write = failWriteFor(statements, 'fm_codeless');
    expect(write?.values).toContain('The embedding server answered 503.');
    expect(write?.text).toContain('rag_error_code = NULL');
    // Only while it still has none: a retry may have classified it since.
    expect(write?.text).toContain('AND rag_error_code IS NULL');
  });

  it('writes no sentence without its code: it sets both, or neither', async () => {
    const { sql, statements } = fakeSql([
      candidate('fm_copy', 'running'),
      candidate('fm_dead', 'queued', {
        ragError: NO_MODEL,
        ragErrorCode: 'embedding_not_configured',
      }),
      candidate('fm_known', 'failed', { ragError: RAG_INTERRUPTED_MESSAGE }),
      candidate('fm_kept', 'queued', {
        ragError: NO_MODEL,
        ragErrorCode: 'embedding_not_configured',
      }),
    ]);
    corpusAnswering([
      {
        file_id: 's3:fm_copy',
        status: 'failed',
        error: 'No text extractor exists for "copy.bin".',
        updated_at: null,
      },
      {
        file_id: 's3:fm_known',
        status: 'failed',
        error: 'The embedding server answered 503.',
        updated_at: null,
      },
      {
        file_id: 's3:fm_kept',
        status: 'failed',
        error: NO_MODEL,
        updated_at: null,
      },
    ]);

    await recoverStuckRagIndexing(sql, { staleMs: 1000 });

    // The corpus copy, the interrupted text and the correction each set
    // `rag_error_code` beside `rag_error`; the kept pair sets neither.
    const writes = writesOf(statements);
    expect(writes).toHaveLength(4);
    for (const write of writes) {
      expect(write.text.includes('rag_error =')).toBe(
        write.text.includes('rag_error_code = NULL'),
      );
    }
    expect(writes.filter((s) => s.text.includes('rag_error ='))).toHaveLength(
      3,
    );
  });
});

describe('recoverStuckRagIndexing — the failed rows in rotation', () => {
  // Settled failures write nothing, so nothing moved them: read by queue
  // time, the same oldest two hundred filled every batch until they left
  // the window, and a false failure queued after them was never reached.
  it('stamps every failed row it read, and no stuck one, moving no status clock and waiting for no lock', async () => {
    const { sql, statements } = fakeSql([
      candidate('fm_stuck'),
      candidate('fm_settled', 'failed', { ragError: 'Settled.' }),
      candidate('fm_other', 'failed', {
        orgId: 'org_2',
        ragError: 'Settled.',
      }),
    ]);
    corpusAnswering([
      {
        file_id: 's3:fm_settled',
        status: 'failed',
        error: 'Settled.',
        updated_at: null,
      },
      {
        file_id: 's3:fm_other',
        status: 'failed',
        error: 'Settled.',
        updated_at: null,
      },
    ]);

    await recoverStuckRagIndexing(sql, { staleMs: 1000 });

    const stamps = stampsOf(statements);
    expect(stamps).toHaveLength(1);
    expect(stamps[0]?.values).toContainEqual(['fm_settled', 'fm_other']);
    expect(stamps[0]?.text).toContain("AND rag_status = 'failed'");
    expect(stamps[0]?.text).toContain('FOR NO KEY UPDATE SKIP LOCKED');
    // It sets the stamp alone: no status, and no status clock.
    expect(stamps[0]?.text).toMatch(
      /^UPDATE app\.file_metadata SET rag_reconciled_at_ms = \? WHERE /,
    );
    expect(stamps[0]?.text).not.toContain('status_changed_at_ms');
    // The stamp is no status write: only the stuck row's settle is told.
    expect(toldAbout(statements, 'org_1')).toEqual(['fm_stuck']);
    expect(toldAbout(statements, 'org_2')).toEqual([]);
  });

  it('sends no stamp when it read no failed row', async () => {
    const { sql, statements } = fakeSql([candidate('fm_stuck')]);
    corpusAnswering([]);

    await recoverStuckRagIndexing(sql, { staleMs: 1000 });

    expect(stampsOf(statements)).toEqual([]);
  });

  it('still settles the batch when the stamp fails', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sql, statements } = fakeSql(
      [candidate('fm_stuck'), candidate('fm_failed', 'failed')],
      { failStamp: true },
    );
    corpusAnswering([]);

    const result = await recoverStuckRagIndexing(sql, { staleMs: 1000 });

    expect(result).toEqual({ adopted: 0, failed: 1, revived: 0 });
    expect(failWriteFor(statements, 'fm_stuck')).toBeDefined();
    expect(warned).toHaveBeenCalledWith(
      expect.stringContaining(
        'could not stamp 1 failed rag row(s) as reconciled',
      ),
      'Connection terminated unexpectedly',
    );
    warned.mockRestore();
  });
});

describe('recoverStuckRagIndexing — a lock held on a row', () => {
  // The app pool sets no lock timeout: a row another transaction held made
  // the write wait for as long as that transaction ran, and the whole sweep
  // with it. Only a write that throws reaches the per-row isolation.
  it('runs every status write in a transaction of its own, under a lock timeout', async () => {
    const { sql, statements } = fakeSql([
      candidate('fm_done'),
      candidate('fm_known', 'failed'),
      candidate('fm_loud'),
      candidate('fm_live', 'failed'),
      candidate('fm_dead'),
    ]);
    corpusAnswering([
      {
        file_id: 's3:fm_done',
        status: 'completed',
        error: null,
        updated_at: null,
      },
      {
        file_id: 's3:fm_known',
        status: 'failed',
        error: 'The embedding server answered 503.',
        updated_at: null,
      },
      {
        file_id: 's3:fm_loud',
        status: 'failed',
        error: 'No text extractor exists for "loud.bin".',
        updated_at: null,
      },
      {
        file_id: 's3:fm_live',
        status: 'processing',
        error: null,
        updated_at: new Date().toISOString(),
      },
    ]);

    const result = await recoverStuckRagIndexing(sql, { staleMs: 60_000 });

    // An adoption, a corrected text, a corpus failure, a revival and an
    // interrupted run: every kind of write the sweep sends.
    expect(result).toEqual({ adopted: 1, failed: 2, revived: 1 });
    const writes = writesOf(statements);
    expect(writes).toHaveLength(5);
    for (const write of writes) {
      expect(write.transaction).not.toBeNull();
      expect(
        statements
          .filter((s) => s.transaction === write.transaction)
          .map((s) => s.text),
      ).toEqual(["SET LOCAL lock_timeout = '2s'", write.text]);
    }
    expect(new Set(writes.map((write) => write.transaction)).size).toBe(5);
  });
});

describe('recoverStuckRagIndexing — who hears a sweep', () => {
  it('tells a document bound after the candidate read about its settled status', async () => {
    const { sql } = fakeSql(
      [candidate('fm_late_bind', 'running', { listed: false })],
      { bindBeforeWrite: 'fm_late_bind' },
    );
    corpusAnswering([
      {
        file_id: 's3:fm_late_bind',
        status: 'completed',
        error: null,
        updated_at: null,
      },
    ]);

    const result = await recoverStuckRagIndexing(sql);

    expect(result).toEqual({ adopted: 1, failed: 0, revived: 0 });
    expect(vi.mocked(emitHintInTx).mock.calls.map(([, hint]) => hint)).toEqual([
      { orgId: 'org_1', entity: 'document', entityId: null },
    ]);
  });

  it('does not count or hint a candidate deleted before its status write', async () => {
    const { sql } = fakeSql([candidate('fm_deleted')], {
      deleteBeforeWrite: 'fm_deleted',
    });
    corpusAnswering([]);

    expect(await recoverStuckRagIndexing(sql)).toEqual({
      adopted: 0,
      failed: 0,
      revived: 0,
    });
    expect(vi.mocked(emitHintInTx)).not.toHaveBeenCalled();
  });

  it('tells each organization’s lists once, for every kind of write', async () => {
    const { sql } = fakeSql([
      candidate('fm_done'),
      candidate('fm_dead'),
      candidate('fm_live', 'failed'),
      candidate('fm_other', 'running', { orgId: 'org_2' }),
    ]);
    corpusAnswering([
      {
        file_id: 's3:fm_done',
        status: 'completed',
        error: null,
        updated_at: null,
      },
      {
        file_id: 's3:fm_live',
        status: 'processing',
        error: null,
        updated_at: new Date().toISOString(),
      },
    ]);

    const result = await recoverStuckRagIndexing(sql, { staleMs: 60_000 });

    // An adoption, a revival and an interrupted run in org_1, one more
    // interrupted run in org_2: one hint per organization.
    expect(result).toEqual({ adopted: 1, failed: 2, revived: 1 });
    expect(vi.mocked(emitHintInTx).mock.calls.map(([, hint]) => hint)).toEqual([
      { orgId: 'org_1', entity: 'document', entityId: null },
      { orgId: 'org_2', entity: 'document', entityId: null },
    ]);
  });

  // A stuck chat, task or email attachment is on no list: settling it must
  // not make every open Documents list in the organization refetch.
  it('tells no list about the attachments it settles', async () => {
    const { sql } = fakeSql([
      candidate('fm_chat_done', 'running', { listed: false }),
      candidate('fm_task_dead', 'running', { listed: false }),
    ]);
    corpusAnswering([
      {
        file_id: 's3:fm_chat_done',
        status: 'completed',
        error: null,
        updated_at: null,
      },
    ]);

    const result = await recoverStuckRagIndexing(sql, { staleMs: 1000 });

    expect(result).toEqual({ adopted: 1, failed: 1, revived: 0 });
    expect(vi.mocked(emitHintInTx)).not.toHaveBeenCalled();
  });

  it('tells an organization whose listed row moved, beside its attachments', async () => {
    const { sql } = fakeSql([
      candidate('fm_chat', 'running', { listed: false }),
      candidate('fm_doc', 'running'),
    ]);
    corpusAnswering([]);

    await recoverStuckRagIndexing(sql, { staleMs: 1000 });

    expect(vi.mocked(emitHintInTx)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emitHintInTx).mock.calls[0]?.[1]).toEqual({
      orgId: 'org_1',
      entity: 'document',
      entityId: null,
    });
  });
});

describe('recoverStuckRagIndexing — a fault mid-sweep', () => {
  // Each write commits on its own, and the candidates come in the same
  // order every tick: a row whose write keeps throwing (a lock held across
  // ticks) must hold back neither the rows after it, nor what the lists
  // hear, nor the organizations after this one.
  it('defers only the row whose write threw, and settles and tells the rows after it', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sql, statements } = fakeSql(
      [
        candidate('fm_a'),
        candidate('fm_b'),
        candidate('fm_c'),
        candidate('fm_d', 'running', { orgId: 'org_2' }),
      ],
      { failWrites: ['fm_b'] },
    );
    corpusAnswering([]);

    const result = await recoverStuckRagIndexing(sql, { staleMs: 1000 });

    // fm_b threw and waits for the next tick; fm_a, fm_c and fm_d settled.
    expect(result).toEqual({ adopted: 0, failed: 3, revived: 0 });
    expect(failWriteFor(statements, 'fm_c')).toBeDefined();
    expect(failWriteFor(statements, 'fm_d')).toBeDefined();
    expect(toldAbout(statements, 'org_1')).toEqual(['fm_a', 'fm_c']);
    expect(vi.mocked(emitHintInTx).mock.calls.map(([, hint]) => hint)).toEqual([
      { orgId: 'org_1', entity: 'document', entityId: null },
      { orgId: 'org_2', entity: 'document', entityId: null },
    ]);
    expect(warned).toHaveBeenCalledWith(
      expect.stringContaining('rag settle failed for file fm_b in org acme'),
      'canceling statement due to lock timeout',
    );
    warned.mockRestore();
  });

  // One failing write is its row's; a second straight after it points at
  // the connection, which is not sent the rest of the organization's batch.
  it('stops an organization after two writes in a row threw, and still sweeps the next one', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sql, statements } = fakeSql(
      [
        candidate('fm_a'),
        candidate('fm_b'),
        candidate('fm_c'),
        candidate('fm_e'),
        candidate('fm_d', 'running', { orgId: 'org_2' }),
      ],
      { failWrites: ['fm_b', 'fm_c'] },
    );
    corpusAnswering([]);

    const result = await recoverStuckRagIndexing(sql, { staleMs: 1000 });

    // fm_a and fm_d settled; fm_e waits for the next tick with fm_b and fm_c.
    expect(result).toEqual({ adopted: 0, failed: 2, revived: 0 });
    expect(failWriteFor(statements, 'fm_e')).toBeUndefined();
    expect(failWriteFor(statements, 'fm_d')).toBeDefined();
    expect(toldAbout(statements, 'org_1')).toEqual(['fm_a']);
    expect(vi.mocked(emitHintInTx).mock.calls.map(([, hint]) => hint)).toEqual([
      { orgId: 'org_1', entity: 'document', entityId: null },
      { orgId: 'org_2', entity: 'document', entityId: null },
    ]);
    expect(warned).toHaveBeenCalledWith(
      expect.stringContaining(
        '2 rag settles in a row failed for org acme; deferring its 1 remaining row(s)',
      ),
    );
    warned.mockRestore();
  });

  it('keeps settling after a fault once a write between goes through', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sql, statements } = fakeSql(
      [
        candidate('fm_a'),
        candidate('fm_b'),
        candidate('fm_c'),
        candidate('fm_e'),
      ],
      { failWrites: ['fm_a', 'fm_c'] },
    );
    corpusAnswering([]);

    const result = await recoverStuckRagIndexing(sql, { staleMs: 1000 });

    // fm_b's write ended the first run of faults, so fm_c's is a run of one.
    expect(result).toEqual({ adopted: 0, failed: 2, revived: 0 });
    expect(failWriteFor(statements, 'fm_e')).toBeDefined();
    warned.mockRestore();
  });

  // A row the rules leave as it is sends no statement, so it says nothing
  // about the connection.
  it('does not take a row it writes nothing for as a write that went through', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sql, statements } = fakeSql(
      [
        candidate('fm_a'),
        candidate('fm_kept', 'failed'),
        candidate('fm_c'),
        candidate('fm_e'),
      ],
      { failWrites: ['fm_a', 'fm_c'] },
    );
    corpusAnswering([]);

    const result = await recoverStuckRagIndexing(sql, { staleMs: 1000 });

    expect(result).toEqual({ adopted: 0, failed: 0, revived: 0 });
    expect(failWriteFor(statements, 'fm_e')).toBeUndefined();
    warned.mockRestore();
  });

  it('still sweeps the next organization when one organization cannot be read', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sql, statements } = fakeSql(
      [candidate('fm_a'), candidate('fm_d', 'running', { orgId: 'org_2' })],
      { failSlugFor: 'org_1' },
    );
    corpusAnswering([]);

    const result = await recoverStuckRagIndexing(sql, { staleMs: 1000 });

    // fm_a waits for the next tick with its organization; fm_d settled.
    expect(result).toEqual({ adopted: 0, failed: 1, revived: 0 });
    expect(failWriteFor(statements, 'fm_a')).toBeUndefined();
    expect(failWriteFor(statements, 'fm_d')).toBeDefined();
    expect(vi.mocked(emitHintInTx).mock.calls.map(([, hint]) => hint)).toEqual([
      { orgId: 'org_2', entity: 'document', entityId: null },
    ]);
    expect(warned).toHaveBeenCalledWith(
      expect.stringContaining('rag sweep failed for org org_1'),
      'Connection terminated unexpectedly',
    );
    warned.mockRestore();
  });

  it('tells no list when the first write threw, and still sweeps the next organization', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sql } = fakeSql(
      [candidate('fm_a'), candidate('fm_d', 'running', { orgId: 'org_2' })],
      { failWrites: ['fm_a'] },
    );
    corpusAnswering([]);

    const result = await recoverStuckRagIndexing(sql, { staleMs: 1000 });

    expect(result).toEqual({ adopted: 0, failed: 1, revived: 0 });
    expect(vi.mocked(emitHintInTx).mock.calls.map(([, hint]) => hint)).toEqual([
      { orgId: 'org_2', entity: 'document', entityId: null },
    ]);
    warned.mockRestore();
  });

  it('still sweeps the next organization when a hint cannot be written', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(emitHintInTx).mockRejectedValueOnce(new Error('outbox down'));
    const { sql } = fakeSql([
      candidate('fm_a'),
      candidate('fm_d', 'running', { orgId: 'org_2' }),
    ]);
    corpusAnswering([]);

    const result = await recoverStuckRagIndexing(sql, { staleMs: 1000 });

    expect(result).toEqual({ adopted: 0, failed: 2, revived: 0 });
    expect(vi.mocked(emitHintInTx).mock.calls.map(([, hint]) => hint)).toEqual([
      { orgId: 'org_1', entity: 'document', entityId: null },
      { orgId: 'org_2', entity: 'document', entityId: null },
    ]);
    expect(warned).toHaveBeenCalledWith(
      expect.stringContaining(
        "could not tell org acme's document lists about 1 settled row(s)",
      ),
      'outbox down',
    );
    warned.mockRestore();
  });
});
