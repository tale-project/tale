import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadProjectOrThrow, type ProjectRow } from '../projects/service.ts';
import { createTask } from './service.ts';

vi.mock('../collab/service.ts', () => ({
  autoSubscribe: vi.fn(),
  dismissReviewerAssignedNotifications: vi.fn(),
  notifyTaskAssigned: vi.fn(),
  notifyTaskReviewerAssigned: vi.fn(),
  notifyTaskStatusChanged: vi.fn(),
}));
vi.mock('../events/emit.ts', () => ({ emitEvent: vi.fn() }));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('../files/upload-intents.ts', () => ({
  firstForeignUpload: vi.fn().mockResolvedValue(null),
}));
vi.mock('./reviews.ts', () => ({
  getPendingReviewForTask: vi.fn(() => Promise.resolve(null)),
  closePendingTaskReviewOnStatusLeave: vi.fn(),
  collectPendingReviewsForProjects: vi.fn(() => Promise.resolve([])),
  requestTaskReview: vi.fn(),
  retargetPendingTaskReview: vi.fn(),
  reviewerEligibility: vi.fn(() => Promise.resolve('eligible')),
}));
vi.mock('./agent-runs.ts', () => ({
  cancelAgentRunInTx: vi.fn(),
  kickAgentRun: vi.fn(),
}));
vi.mock('../projects/service.ts', () => ({
  listProjects: vi.fn(),
  loadProjectOrThrow: vi.fn(),
}));

const auth = {
  organizationId: 'org-1',
  userId: 'u-owner',
  email: 'owner@example.com',
  role: 'owner',
  teamIds: [] as string[],
};

const project = {
  id: 'p-1',
  organizationId: 'org-1',
  name: 'Board',
  key: 'BRD',
  archivedAt: null,
  canEdit: true,
} as unknown as ProjectRow;

/** Records every statement and answers the few reads a create makes. */
function fakeTx() {
  const statements: { text: string; values: unknown[] }[] = [];
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.startsWith('INSERT INTO app.tasks')) {
      return Promise.resolve([{ id: 't-new' }]);
    }
    if (text.includes('task_counter')) {
      return Promise.resolve([{ number: 7, taskCounter: 7 }]);
    }
    return Promise.resolve([]);
  };
  const tx = Object.assign(tag, {
    json: (value: unknown) => ({ json: value }),
    unsafe: (text: string): unknown => text,
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stand-in for the postgres.js transaction function
  return { tx: tx as unknown as TransactionSql, statements };
}

/** The stamp the task INSERT binds for the start-date bell. */
function insertedStamp(statements: { text: string; values: unknown[] }[]) {
  const insert = statements.find((statement) =>
    statement.text.startsWith('INSERT INTO app.tasks'),
  );
  if (insert === undefined) throw new Error('no task insert');
  const columns = insert.text
    .slice(insert.text.indexOf('(') + 1, insert.text.indexOf(')'))
    .split(',')
    .map((column) => column.trim());
  return insert.values[columns.indexOf('start_notified_at_ms')];
}

beforeEach(() => {
  vi.mocked(loadProjectOrThrow).mockReset().mockResolvedValue(project);
});

describe('createTask — a start date that has already arrived raises no bell [TASK-R23]', () => {
  it('writes a task starting today as already announced', async () => {
    const before = Date.now();
    const { tx, statements } = fakeTx();
    await createTask(tx, auth, {
      projectId: 'p-1',
      title: 'Ship the pricing page',
      startDate: before - 1_000,
    });
    expect(insertedStamp(statements)).toBeGreaterThanOrEqual(before);
  });

  it('leaves a task starting later, or with no start, unstamped', async () => {
    const later = fakeTx();
    await createTask(later.tx, auth, {
      projectId: 'p-1',
      title: 'Plan the launch',
      startDate: Date.now() + 2 * 86_400_000,
    });
    expect(insertedStamp(later.statements)).toBeNull();

    const none = fakeTx();
    await createTask(none.tx, auth, { projectId: 'p-1', title: 'Someday' });
    expect(insertedStamp(none.statements)).toBeNull();
  });
});
