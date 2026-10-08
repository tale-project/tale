/**
 * The hourly pass over files a usage limit parked: each is queued again, in
 * batches it locks while it moves them, and only the files parked before
 * the pass began — a file it re-queued, parked again by its job's budget
 * check at once, waits for the next pass instead of looping this one.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../jobs/enqueue.ts', () => ({
  addJobInTx: vi.fn(() => Promise.resolve('job-1')),
}));
vi.mock('./status-hints.ts', () => ({
  HELD_BY_DOCUMENT_SQL: 'true',
  hintDocumentLists: vi.fn(async () => undefined),
}));

import { addJobInTx } from '../../jobs/enqueue.ts';
import { requeueUsageLimitedFiles } from './usage-limit-resume.ts';

interface Statement {
  text: string;
  values: unknown[];
}

function fakeSql(batches: { id: string }[][]): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  let next = 0;
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push({
      text: strings.join('?').replace(/\s+/g, ' ').trim(),
      values,
    });
    const rows = (batches[next] ?? []).map((row) => ({
      id: row.id,
      orgId: 'org-1',
      listed: true,
    }));
    next += 1;
    return Promise.resolve(rows);
  };
  const sql = Object.assign(tag, {
    unsafe: (text: string) => text,
    begin: async (work: (tx: unknown) => Promise<unknown>) => work(sql),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, statements };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requeueUsageLimitedFiles', () => {
  it('queues every parked file again, in locked batches, fenced at the pass’s start', async () => {
    const full = Array.from({ length: 200 }, (_, index) => ({
      id: `f-${index}`,
    }));
    const { sql, statements } = fakeSql([full, [{ id: 'f-last' }]]);

    await expect(requeueUsageLimitedFiles(sql, 1_000)).resolves.toBe(201);

    expect(statements).toHaveLength(2);
    const first = statements[0];
    expect(first?.text).toContain('FOR UPDATE SKIP LOCKED');
    expect(first?.text).toContain("rag_status = 'failed'");
    expect(first?.values).toEqual(
      expect.arrayContaining(['usage_limit', 1_000]),
    );
    expect(first?.text).toContain('coalesce(rag_queued_at_ms, 0) < ?');
    expect(addJobInTx).toHaveBeenCalledTimes(201);
    expect(addJobInTx).toHaveBeenLastCalledWith(sql, 'rag.index_file', {
      fileId: 'f-last',
    });
  });

  it('does nothing when no file is parked', async () => {
    const { sql } = fakeSql([[]]);
    await expect(requeueUsageLimitedFiles(sql, 1_000)).resolves.toBe(0);
    expect(addJobInTx).not.toHaveBeenCalled();
  });
});
