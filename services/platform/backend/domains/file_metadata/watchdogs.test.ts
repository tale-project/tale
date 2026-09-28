// @vitest-environment node

/**
 * Unit lock for the RAG reconcile sweep's settle text: a dead chain is failed
 * with guidance that points at the Retry indexing button the failed badge
 * already carries — never at a re-upload, which the text once demanded even
 * though the blob is still stored and the retry re-ingests it. The corpus's
 * own error, when it has one, always wins over the generic text, and an
 * already-failed row is never overwritten with it. Each organization's
 * document lists hear a sweep once, and only for rows a document holds —
 * also when a later write of the organization throws, which defers its
 * unsettled rows and never the organizations after it. The stale-window
 * scan and the adopt/revive rules ride the real-Postgres probe in
 * `integration-check.ts`.
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
}

interface Candidate {
  id: string;
  orgId: string;
  storageRef: string;
  ragStatus: string;
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
 * Scripted `sql`: the candidate read is a snapshot, while the ownership
 * read sees the current state. A bind or deletion may land between that
 * snapshot and the status write, as the real-Postgres lane proves too. The
 * status write of `failWrite` throws, as a lock timeout would.
 */
function fakeSql(
  candidates: Candidate[],
  options: {
    bindBeforeWrite?: string;
    deleteBeforeWrite?: string;
    failWrite?: string;
  } = {},
): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const current = new Map(candidates.map((row) => [row.id, { ...row }]));
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.startsWith('SELECT id,')) {
      return Promise.resolve(candidates.map((row) => ({ ...row })));
    }
    if (text.startsWith('UPDATE app.file_metadata')) {
      const id = candidates.find((row) => values.includes(row.id))?.id;
      if (id !== undefined && id === options.failWrite) {
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
      return Promise.resolve([{ slug: 'acme' }]);
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(fn, { unsafe: (raw: string) => raw });
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
  // Each write commits on its own: a later one that throws must neither
  // leave the rows already settled unheard by an open list, nor stop the
  // sweep of the organizations after this one.
  it('tells the lists about the rows settled before a write threw, and sweeps the next organization', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sql, statements } = fakeSql(
      [
        candidate('fm_a'),
        candidate('fm_b'),
        candidate('fm_c'),
        candidate('fm_d', 'running', { orgId: 'org_2' }),
      ],
      { failWrite: 'fm_b' },
    );
    corpusAnswering([]);

    const result = await recoverStuckRagIndexing(sql, { staleMs: 1000 });

    // fm_a and fm_d settled; fm_b threw, and fm_c waits for the next tick.
    expect(result).toEqual({ adopted: 0, failed: 2, revived: 0 });
    expect(failWriteFor(statements, 'fm_c')).toBeUndefined();
    expect(failWriteFor(statements, 'fm_d')).toBeDefined();
    expect(vi.mocked(emitHintInTx).mock.calls.map(([, hint]) => hint)).toEqual([
      { orgId: 'org_1', entity: 'document', entityId: null },
      { orgId: 'org_2', entity: 'document', entityId: null },
    ]);
    expect(warned).toHaveBeenCalledWith(
      expect.stringContaining(
        'rag settle failed for org acme after moving 1 row(s)',
      ),
      'canceling statement due to lock timeout',
    );
    warned.mockRestore();
  });

  it('tells no list when the first write threw, and still sweeps the next organization', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sql } = fakeSql(
      [candidate('fm_a'), candidate('fm_d', 'running', { orgId: 'org_2' })],
      { failWrite: 'fm_a' },
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
