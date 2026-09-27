import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  autoSubscribe,
  notifyTaskReviewerAssigned,
} from '../collab/service.ts';
import { loadProjectOrThrow, type ProjectRow } from '../projects/service.ts';
import { retargetPendingTaskReview } from './reviews.ts';
import { type TaskRow, updateTask } from './service.ts';

vi.mock('../collab/service.ts', () => ({
  autoSubscribe: vi.fn(),
  notifyTaskAssigned: vi.fn(),
  notifyTaskReviewerAssigned: vi.fn(),
  notifyTaskStatusChanged: vi.fn(),
}));
vi.mock('../events/emit.ts', () => ({ emitEvent: vi.fn() }));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('../../auth/membership.ts', () => ({
  findOrganizationMember: vi.fn((_sql, organizationId, userId) =>
    Promise.resolve({
      id: `m-${userId}`,
      organizationId,
      userId,
      role: 'editor',
    }),
  ),
}));
vi.mock('./reviews.ts', () => ({
  closePendingTaskReviewOnStatusLeave: vi.fn(),
  collectPendingReviewsForProjects: vi.fn(() => Promise.resolve([])),
  requestTaskReview: vi.fn(),
  retargetPendingTaskReview: vi.fn(),
}));
vi.mock('./agent-runs.ts', () => ({
  cancelAgentRunInTx: vi.fn(),
  kickAgentRun: vi.fn(),
}));
vi.mock('../projects/service.ts', () => ({
  listProjects: vi.fn(),
  loadProjectOrThrow: vi.fn(),
}));

/**
 * `updateTask`'s reviewer designation: an open review moves with it in the
 * same transaction (`retargetPendingTaskReview`, pinned in its own suite),
 * and a designee who now holds that open request is not ALSO sent the
 * "you're the reviewer" heads-up — both share one collapse identity, so the
 * heads-up would rewrite the actionable request bell in place.
 */

const auth = {
  organizationId: 'org-1',
  userId: 'u-owner',
  email: 'owner@example.com',
  role: 'owner',
  teamIds: [] as string[],
};

const project: ProjectRow = {
  id: 'p-1',
  organizationId: 'org-1',
  name: 'Board',
  description: null,
  icon: null,
  color: null,
  key: 'BRD',
  externalItemId: null,
  taskCounter: 1,
  openTaskCount: 1,
  doneTaskCount: 0,
  projectAgentCount: 0,
  teamId: null,
  sharedWithTeamIds: [],
  teamIds: [],
  instructions: null,
  createdBy: 'u-owner',
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  pinnedAt: null,
};

function taskRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 't-1',
    organizationId: 'org-1',
    projectId: 'p-1',
    title: 'Launch notes',
    description: null,
    attachments: null,
    outputs: null,
    number: 1,
    status: 'in_review',
    priority: null,
    labelIds: [],
    assigneeType: null,
    assigneeId: null,
    reviewerUserId: 'u-alice',
    parentTaskId: null,
    commentCount: 0,
    rank: 'a0',
    externalSystem: null,
    externalId: null,
    externalUrl: null,
    threadId: null,
    discussionThreadId: null,
    sourceDiscussionThreadId: null,
    startDate: null,
    startNotifiedAt: null,
    dueDate: null,
    slaLevel: null,
    slaLevelAt: null,
    statusChangedAt: null,
    totalCostCents: null,
    agentRunCount: 0,
    lastAgentRunAt: null,
    claimedAt: null,
    completedAt: null,
    externalClosedAt: null,
    createdBy: 'u-owner',
    createdByType: 'user',
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    ...overrides,
  };
}

function fakeTx(fixture: TaskRow): TransactionSql {
  const tag = (strings: TemplateStringsArray): Promise<unknown[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    return Promise.resolve(
      text.startsWith('SELECT ? FROM app.tasks WHERE id = ?') ? [fixture] : [],
    );
  };
  const tx = Object.assign(tag, {
    json: (value: unknown) => ({ json: value }),
    unsafe: (text: string): unknown => text,
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- three-member stand-in for the postgres.js transaction function
  return tx as unknown as TransactionSql;
}

beforeEach(() => {
  vi.mocked(loadProjectOrThrow).mockReset().mockResolvedValue(project);
  vi.mocked(retargetPendingTaskReview).mockReset().mockResolvedValue(undefined);
  vi.mocked(autoSubscribe).mockReset();
  vi.mocked(notifyTaskReviewerAssigned).mockReset();
});

describe('updateTask — the open review follows the reviewer', () => {
  it('hands the open review to the new designee in the same transaction, without the heads-up', async () => {
    vi.mocked(retargetPendingTaskReview).mockResolvedValue('u-bob');
    const tx = fakeTx(taskRow());

    await updateTask(tx, auth, {
      taskId: 't-1',
      reviewerUserId: 'u-bob',
      title: 'Launch notes v2',
    });

    // The gate sees the task as it now stands: the new designee, and the
    // title the request bell will quote.
    expect(retargetPendingTaskReview).toHaveBeenCalledWith(tx, {
      task: expect.objectContaining({
        id: 't-1',
        reviewerUserId: 'u-bob',
        title: 'Launch notes v2',
      }),
      actorUserId: 'u-owner',
    });
    expect(autoSubscribe).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ subscriberId: 'u-bob', reason: 'reviewer' }),
    );
    expect(notifyTaskReviewerAssigned).not.toHaveBeenCalled();
  });

  it('still sends the heads-up when no review is open yet', async () => {
    const tx = fakeTx(taskRow({ status: 'todo' }));

    await updateTask(tx, auth, { taskId: 't-1', reviewerUserId: 'u-bob' });

    expect(retargetPendingTaskReview).toHaveBeenCalledTimes(1);
    expect(notifyTaskReviewerAssigned).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ reviewerUserId: 'u-bob' }),
    );
  });

  it('still sends the heads-up when the open review resolves past the designee', async () => {
    // The designee lost project edit access: the request falls through the
    // chain to someone else, so theirs is the only bell they get.
    vi.mocked(retargetPendingTaskReview).mockResolvedValue('u-owner');
    const tx = fakeTx(taskRow());

    await updateTask(tx, auth, { taskId: 't-1', reviewerUserId: 'u-bob' });

    expect(notifyTaskReviewerAssigned).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ reviewerUserId: 'u-bob' }),
    );
  });

  it('hands a cleared review back to the gate to resolve, belling no designee', async () => {
    vi.mocked(retargetPendingTaskReview).mockResolvedValue('u-owner');
    const tx = fakeTx(taskRow());

    await updateTask(tx, auth, { taskId: 't-1', reviewerUserId: null });

    expect(retargetPendingTaskReview).toHaveBeenCalledWith(tx, {
      task: expect.objectContaining({ reviewerUserId: null }),
      actorUserId: 'u-owner',
    });
    expect(autoSubscribe).not.toHaveBeenCalled();
    expect(notifyTaskReviewerAssigned).not.toHaveBeenCalled();
  });

  it('leaves the open review alone when the reviewer did not change', async () => {
    const tx = fakeTx(taskRow());

    await updateTask(tx, auth, { taskId: 't-1', title: 'Renamed' });
    await updateTask(tx, auth, { taskId: 't-1', reviewerUserId: 'u-alice' });

    expect(retargetPendingTaskReview).not.toHaveBeenCalled();
    expect(notifyTaskReviewerAssigned).not.toHaveBeenCalled();
  });
});
