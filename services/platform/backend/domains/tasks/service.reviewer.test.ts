import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  autoSubscribe,
  dismissReviewerAssignedNotifications,
  notifyTaskReviewerAssigned,
} from '../collab/service.ts';
import { loadProjectOrThrow, type ProjectRow } from '../projects/service.ts';
import {
  getPendingReviewForTask,
  retargetPendingTaskReview,
  reviewerEligibility,
} from './reviews.ts';
import { type TaskRow, updateTask } from './service.ts';

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
vi.mock('./reviews.ts', () => ({
  getPendingReviewForTask: vi.fn(() => Promise.resolve(null)),
  closePendingTaskReviewOnStatusLeave: vi.fn(),
  collectPendingReviewsForProjects: vi.fn(() => Promise.resolve([])),
  requestTaskReview: vi.fn(),
  retargetPendingTaskReview: vi.fn(),
  reviewerEligibility: vi.fn(),
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
  defaultTaskReviewerAgentId: null,
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
    reviewerAgentId: null,
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
    repeat: null,
    repeatNextTaskId: null,
    repeatContinued: false,
    createdBy: 'u-owner',
    createdByType: 'user',
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    ...overrides,
  };
}

/** Every statement the fake answered, so a refusal can be shown to have
 * written nothing. */
let statements: string[] = [];

function fakeTx(fixture: TaskRow): TransactionSql {
  const tag = (strings: TemplateStringsArray): Promise<unknown[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push(text);
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
  statements = [];
  vi.mocked(loadProjectOrThrow).mockReset().mockResolvedValue(project);
  vi.mocked(retargetPendingTaskReview).mockReset().mockResolvedValue(undefined);
  vi.mocked(getPendingReviewForTask).mockReset().mockResolvedValue(null);
  vi.mocked(reviewerEligibility).mockReset().mockResolvedValue('eligible');
  vi.mocked(autoSubscribe).mockReset();
  vi.mocked(dismissReviewerAssignedNotifications).mockReset();
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

/**
 * A designee is held to the rule the gate resolves by. Before this, only
 * org membership was checked: a designee who could not edit the project was
 * stored, belled with "You're the reviewer", and then routed past at mint —
 * the review landing, silently, on a creator.
 */
describe('updateTask — who can be designated', () => {
  it('refuses a designee who cannot edit the project, writing nothing', async () => {
    vi.mocked(reviewerEligibility).mockResolvedValue('cannot_edit');
    const tx = fakeTx(taskRow({ status: 'todo' }));

    await expect(
      updateTask(tx, auth, { taskId: 't-1', reviewerUserId: 'u-viewer' }),
    ).rejects.toMatchObject({
      name: 'TaskError',
      code: 'TASK_REVIEWER_NO_EDIT_ACCESS',
      status: 400,
    });

    // Judged against the project's own audience.
    expect(reviewerEligibility).toHaveBeenCalledWith(tx, {
      organizationId: 'org-1',
      projectTeamIds: [],
      userId: 'u-viewer',
    });
    expect(statements.some((text) => text.startsWith('UPDATE app.tasks'))).toBe(
      false,
    );
    expect(retargetPendingTaskReview).not.toHaveBeenCalled();
    expect(dismissReviewerAssignedNotifications).not.toHaveBeenCalled();
    expect(autoSubscribe).not.toHaveBeenCalled();
    expect(notifyTaskReviewerAssigned).not.toHaveBeenCalled();
  });

  it('refuses a designee who is no longer a live member', async () => {
    vi.mocked(reviewerEligibility).mockResolvedValue('not_member');
    const tx = fakeTx(taskRow({ status: 'todo' }));

    await expect(
      updateTask(tx, auth, { taskId: 't-1', reviewerUserId: 'u-gone' }),
    ).rejects.toMatchObject({ code: 'TASK_REVIEWER_INVALID', status: 400 });
    expect(statements.some((text) => text.startsWith('UPDATE app.tasks'))).toBe(
      false,
    );
  });

  it('judges only a new designee — a clear or a re-select asks nothing', async () => {
    const tx = fakeTx(taskRow());

    await updateTask(tx, auth, { taskId: 't-1', reviewerUserId: null });
    await updateTask(tx, auth, { taskId: 't-1', reviewerUserId: 'u-alice' });

    expect(reviewerEligibility).not.toHaveBeenCalled();
  });
});

/**
 * The "You're the reviewer" heads-up is for whoever holds the designation.
 * Before this, a change ahead of In review left the previous designee's
 * unread heads-up ringing.
 */
describe('updateTask — the previous designee is let off the hook', () => {
  it('dismisses the previous designee’s heads-up when the designation moves', async () => {
    const tx = fakeTx(taskRow({ status: 'todo' }));

    await updateTask(tx, auth, { taskId: 't-1', reviewerUserId: 'u-bob' });

    expect(dismissReviewerAssignedNotifications).toHaveBeenCalledWith(tx, {
      organizationId: 'org-1',
      taskId: 't-1',
      userId: 'u-alice',
    });
    // The new designee still gets theirs.
    expect(notifyTaskReviewerAssigned).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ reviewerUserId: 'u-bob' }),
    );
  });

  it('dismisses it when the reviewer is cleared', async () => {
    const tx = fakeTx(taskRow({ status: 'todo' }));

    await updateTask(tx, auth, { taskId: 't-1', reviewerUserId: null });

    expect(dismissReviewerAssignedNotifications).toHaveBeenCalledWith(tx, {
      organizationId: 'org-1',
      taskId: 't-1',
      userId: 'u-alice',
    });
  });

  it('dismisses nothing for a first designation or an unchanged one', async () => {
    await updateTask(fakeTx(taskRow({ reviewerUserId: null })), auth, {
      taskId: 't-1',
      reviewerUserId: 'u-bob',
    });
    await updateTask(fakeTx(taskRow()), auth, {
      taskId: 't-1',
      reviewerUserId: 'u-alice',
    });

    expect(dismissReviewerAssignedNotifications).not.toHaveBeenCalled();
  });
});

describe('legacy reviewer edits preserve delegated ownership', () => {
  it('requires an explicit handoff to replace a configured agent', async () => {
    const tx = fakeTx(
      taskRow({ reviewerUserId: null, reviewerAgentId: 'agent-reviewer' }),
    );
    await expect(
      updateTask(tx, auth, { taskId: 't-1', reviewerUserId: 'u-bob' }),
    ).rejects.toMatchObject({ code: 'TASK_REVIEWER_HANDOFF_REQUIRED' });
    expect(statements.some((text) => text.startsWith('UPDATE'))).toBe(false);
  });

  it('requires an explicit handoff when the captured owner is an agent', async () => {
    vi.mocked(getPendingReviewForTask).mockResolvedValue({
      approvalId: 'a',
      taskId: 't-1',
      runId: 'r',
      round: 0,
      requestedFor: null,
      reviewer: { kind: 'agent', agentId: 'agent-reviewer' },
      agentSlug: null,
      implementationAgentId: null,
      evidenceRevision: null,
      createdAt: 1,
    });
    const tx = fakeTx(taskRow());
    await expect(
      updateTask(tx, auth, { taskId: 't-1', reviewerUserId: 'u-bob' }),
    ).rejects.toMatchObject({ code: 'TASK_REVIEWER_HANDOFF_REQUIRED' });
    expect(statements.some((text) => text.startsWith('UPDATE'))).toBe(false);
  });

  it('does not let an old Clear silently delegate to the project agent default', async () => {
    vi.mocked(loadProjectOrThrow).mockResolvedValue({
      ...project,
      defaultTaskReviewerAgentId: 'agent-reviewer',
    });
    const tx = fakeTx(taskRow());
    await expect(
      updateTask(tx, auth, { taskId: 't-1', reviewerUserId: null }),
    ).rejects.toMatchObject({ code: 'TASK_REVIEWER_HANDOFF_REQUIRED' });
    expect(statements.some((text) => text.startsWith('UPDATE'))).toBe(false);
  });
});
