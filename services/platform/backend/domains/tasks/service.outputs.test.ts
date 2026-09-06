import type { TransactionSql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { agentRecordTaskOutputsTrusted, type TaskRow } from './service.ts';

vi.mock('../collab/service.ts', () => ({
  autoSubscribe: vi.fn(),
  notifyTaskAssigned: vi.fn(),
  notifyTaskStatusChanged: vi.fn(),
}));
vi.mock('../events/emit.ts', () => ({ emitEvent: vi.fn() }));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('./reviews.ts', () => ({
  closePendingTaskReviewOnStatusLeave: vi.fn(),
  collectPendingReviewsForProjects: vi.fn(() => Promise.resolve([])),
  requestTaskReview: vi.fn(),
}));
vi.mock('./agent-runs.ts', () => ({ kickAgentRun: vi.fn() }));
vi.mock('../projects/service.ts', () => ({
  listProjects: vi.fn(),
  loadProjectOrThrow: vi.fn(),
}));

/**
 * The settle's attach step is the ONLY writer of `app.tasks.outputs`, and the
 * provenance ledger keeps only the entries whose `runId` is the settling run
 * — so every merged entry must carry the producing run, or the ledger's
 * deliverables section can never be populated.
 */
function fakeTx(outputs: unknown): {
  tx: TransactionSql;
  writes: unknown[][];
} {
  const writes: unknown[][] = [];
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    if (text.startsWith('SELECT ? FROM app.tasks WHERE id = ?')) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the outputs column matters to the merge under test
      return Promise.resolve([{ id: 't-1', outputs } as TaskRow]);
    }
    if (text.startsWith('UPDATE app.tasks SET outputs')) writes.push(values);
    return Promise.resolve([]);
  };
  const tx = Object.assign(tag, {
    json: (value: unknown) => value,
    unsafe: (text: string): unknown => text,
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a three-member stand-in for the postgres.js transaction function
  return { tx: tx as unknown as TransactionSql, writes };
}

const file = {
  fileId: 's3:out-1',
  fileName: 'report.md',
  fileType: 'text/markdown',
  fileSize: 1234,
};

describe('agentRecordTaskOutputsTrusted — the producing run rides every entry', () => {
  it('stamps the settling run on a new deliverable', async () => {
    const { tx, writes } = fakeTx(null);
    await agentRecordTaskOutputsTrusted(tx, {
      organizationId: 'org-1',
      taskId: 't-1',
      runId: 'run-1',
      files: [file],
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[0]).toEqual([{ ...file, runId: 'run-1' }]);
  });

  it('a same-named deliverable from a later run replaces the entry AND its run', async () => {
    const { tx, writes } = fakeTx([
      { ...file, fileSize: 1, runId: 'run-0' },
      { fileId: 's3:other', fileName: 'keep.md', fileType: 'x', fileSize: 2 },
    ]);
    await agentRecordTaskOutputsTrusted(tx, {
      organizationId: 'org-1',
      taskId: 't-1',
      runId: 'run-1',
      files: [file],
    });
    expect(writes[0]?.[0]).toEqual([
      { ...file, runId: 'run-1' },
      { fileId: 's3:other', fileName: 'keep.md', fileType: 'x', fileSize: 2 },
    ]);
  });

  it('a lane without a run key merges the entry unstamped', async () => {
    const { tx, writes } = fakeTx(null);
    await agentRecordTaskOutputsTrusted(tx, {
      organizationId: 'org-1',
      taskId: 't-1',
      files: [file],
    });
    expect(writes[0]?.[0]).toEqual([file]);
  });
});
