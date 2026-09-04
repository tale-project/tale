// @vitest-environment node

/**
 * Unit lock for the RAG reconcile sweep's settle text: a dead chain is failed
 * with guidance that points at the Retry indexing button the failed badge
 * already carries — never at a re-upload, which the text once demanded even
 * though the blob is still stored and the retry re-ingests it. The corpus's
 * own error, when it has one, always wins over the generic text, and an
 * already-failed row is never overwritten with it. The stale-window scan and
 * the adopt/revive rules ride the real-Postgres probe in
 * `integration-check.ts`.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getKnowledgePoolForOrg } from '../../core/knowledge/pool.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
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
}

interface CorpusRow {
  file_id: string;
  status: string;
  error: string | null;
  updated_at: string | null;
}

/**
 * Scripted `sql`: the candidate SELECT answers the script, the org-slug
 * lookup answers one org, every UPDATE answers no rows. Each statement is
 * recorded so the settle writes can be asserted by shape.
 */
function fakeSql(candidates: Candidate[]): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.includes('FROM app.file_metadata WHERE storage_ref IS NOT NULL')) {
      return Promise.resolve(candidates);
    }
    if (text.includes('FROM "organization"')) {
      return Promise.resolve([{ slug: 'acme' }]);
    }
    return Promise.resolve([]);
  };
  return { sql: fn as unknown as Sql, statements };
}

/** The per-org corpus pool: `unsafe` answers the scripted document rows. */
function corpusAnswering(rows: CorpusRow[]): void {
  const pool = { unsafe: vi.fn(() => Promise.resolve(rows)) };
  vi.mocked(getKnowledgePoolForOrg).mockResolvedValue(pool as unknown as Sql);
}

function candidate(id: string, ragStatus = 'running'): Candidate {
  return { id, orgId: 'org_1', storageRef: `s3:${id}`, ragStatus };
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
    // Both settles nudge the document list.
    expect(vi.mocked(emitHintInTx)).toHaveBeenCalledTimes(2);
  });

  it('never overwrites an already-failed row with the generic text', async () => {
    const { sql, statements } = fakeSql([candidate('fm_failed', 'failed')]);
    corpusAnswering([]);

    const result = await recoverStuckRagIndexing(sql, { staleMs: 1000 });

    expect(result).toEqual({ adopted: 0, failed: 0, revived: 0 });
    expect(failWriteFor(statements, 'fm_failed')).toBeUndefined();
  });
});
