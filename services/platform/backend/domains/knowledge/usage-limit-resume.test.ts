/**
 * The hourly pass over files a usage limit parked: a file is queued again
 * only when its subject's next embedding request would be admitted — asked
 * once per subject, holding nothing — in locked batches, fenced at the
 * pass's start, and never more than a pass's worth at once. A file whose
 * limit still binds stays parked, without a trip through the queue.
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
vi.mock('./service.ts', () => ({
  fileIndexingSubject: vi.fn(
    async (_sql: unknown, row: { uploadedBy: string | null }) => ({
      userId: row.uploadedBy ?? '__automation__',
      agentSlug: '__embedding__',
    }),
  ),
}));
vi.mock('./embedding-meter.ts', () => ({
  embeddingBlocked: vi.fn(async () => null),
}));

import { addJobInTx } from '../../jobs/enqueue.ts';
import { embeddingBlocked } from './embedding-meter.ts';
import { requeueUsageLimitedFiles } from './usage-limit-resume.ts';

interface Statement {
  text: string;
  values: unknown[];
}

interface Parked {
  id: string;
  uploadedBy: string | null;
}

/** Answers the parked-file pages in turn, and moves whatever ids a requeue
 * names. */
function fakeSql(pages: Parked[][]): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  let next = 0;
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.startsWith('SELECT id, org_id')) {
      const page = (pages[next] ?? []).map((row) =>
        Object.assign(
          {
            organizationId: 'org-1',
            storageRef: `s3:org-1/${row.id}`,
            documentId: null,
            projectId: null,
            threadId: null,
          },
          row,
        ),
      );
      next += 1;
      return Promise.resolve(page);
    }
    if (text.includes('UPDATE app.file_metadata fm')) {
      const ids = values.find((value): value is string[] =>
        Array.isArray(value),
      );
      return Promise.resolve(
        (ids ?? []).map((id) => ({ id, orgId: 'org-1', listed: true })),
      );
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(tag, {
    unsafe: (text: string) => text,
    begin: async (work: (tx: unknown) => Promise<unknown>) => work(sql),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, statements };
}

const BLOCKED = {
  scope: 'user' as const,
  code: 'COST_LIMIT' as const,
  period: 'monthly' as const,
  used: 99.5,
  limit: 100,
  reason: 'x',
  resetsAt: Date.UTC(2026, 10, 1),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requeueUsageLimitedFiles', () => {
  it('queues again only the files whose limits have room, asking once per subject [KNOW-R18]', async () => {
    vi.mocked(embeddingBlocked).mockImplementation(async (_sql, args) =>
      args.subject.userId === 'mia' ? BLOCKED : null,
    );
    const page = Array.from({ length: 200 }, (_, index) => ({
      id: `f-${String(index).padStart(3, '0')}`,
      uploadedBy: index % 2 === 0 ? 'mia' : 'noah',
    }));
    const { sql, statements } = fakeSql([
      page,
      [{ id: 'f-999', uploadedBy: 'noah' }],
    ]);

    await expect(requeueUsageLimitedFiles(sql, 1_000)).resolves.toBe(101);

    // Mia's cap keeps her files parked; Noah's have room.
    expect(embeddingBlocked).toHaveBeenCalledTimes(2);
    expect(addJobInTx).toHaveBeenCalledTimes(101);
    expect(
      vi
        .mocked(addJobInTx)
        .mock.calls.every(
          ([, , payload]) =>
            typeof payload === 'object' &&
            payload !== null &&
            Number(String(Reflect.get(payload, 'fileId')).slice(2)) % 2 === 1,
        ),
    ).toBe(true);
    const [firstPage, , secondPage] = statements;
    expect(firstPage?.text).toContain('coalesce(rag_queued_at_ms, 0) < ?');
    expect(firstPage?.values).toEqual(
      expect.arrayContaining(['usage_limit', 1_000, '']),
    );
    expect(secondPage?.values).toContain('f-199');
    const requeue = statements.find((s) =>
      s.text.includes('UPDATE app.file_metadata fm'),
    );
    expect(requeue?.text).toContain('FOR UPDATE SKIP LOCKED');
  });

  it('queues no more than a pass’s worth, leaving the rest for the next', async () => {
    const pages = Array.from({ length: 7 }, (_page, pageIndex) =>
      Array.from({ length: 200 }, (_file, index) => ({
        id: `p${pageIndex}-${String(index).padStart(3, '0')}`,
        uploadedBy: 'noah',
      })),
    );
    const { sql } = fakeSql(pages);

    await expect(requeueUsageLimitedFiles(sql, 1_000)).resolves.toBe(1_000);
    expect(addJobInTx).toHaveBeenCalledTimes(1_000);
  });

  it('does nothing when no file is parked', async () => {
    const { sql } = fakeSql([[]]);
    await expect(requeueUsageLimitedFiles(sql, 1_000)).resolves.toBe(0);
    expect(addJobInTx).not.toHaveBeenCalled();
    expect(embeddingBlocked).not.toHaveBeenCalled();
  });
});
