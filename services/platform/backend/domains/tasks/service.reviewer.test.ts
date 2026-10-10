import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuditLog } from '../audit_logs/service.ts';
import {
  autoSubscribe,
  dismissReviewerAssignedNotifications,
  notifyTaskReviewerAssigned,
} from '../collab/service.ts';
import { loadProjectOrThrow, type ProjectRow } from '../projects/service.ts';
import {
  agentReviewerEligibility,
  getPendingReviewForTask,
  type PendingTaskReview,
  replacePendingTaskReviewer,
  retargetPendingTaskReview,
  reviewerEligibility,
} from './reviews.ts';
import { setTaskReviewer, type TaskRow, updateTask } from './service.ts';

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
  agentReviewerEligibility: vi.fn(),
  replacePendingTaskReviewer: vi.fn(),
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
let activityValues: unknown[][] = [];

function fakeTx(fixture: TaskRow): TransactionSql {
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push(text);
    if (text.startsWith('INSERT INTO app.task_activity'))
      activityValues.push(values);
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
  activityValues = [];
  vi.mocked(createAuditLog).mockReset();
  vi.mocked(agentReviewerEligibility).mockReset().mockResolvedValue('eligible');
  vi.mocked(replacePendingTaskReviewer)
    .mockReset()
    .mockResolvedValue(undefined);
  vi.mocked(loadProjectOrThrow).mockReset().mockResolvedValue(project);
  vi.mocked(retargetPendingTaskReview).mockReset().mockResolvedValue(undefined);
  vi.mocked(getPendingReviewForTask).mockReset().mockResolvedValue(null);
  vi.mocked(reviewerEligibility).mockReset().mockResolvedValue('eligible');
  vi.mocked(autoSubscribe).mockReset();
  vi.mocked(dismissReviewerAssignedNotifications).mockReset();
  vi.mocked(notifyTaskReviewerAssigned).mockReset();
});

function capturedReview(
  approvalId: string,
  reviewer: PendingTaskReview['reviewer'],
): PendingTaskReview {
  return {
    approvalId,
    taskId: 't-1',
    round: 1,
    requestedFor: reviewer?.kind === 'user' ? reviewer.userId : null,
    reviewer,
    agentSlug: null,
    implementationAgentId: 'implementer',
    evidenceRevision: null,
    agentReviewBlockedReason: null,
    runId: 'source-run',
    createdAt: 1,
  };
}

describe('setTaskReviewer captured handoff history', () => {
  const inherit = { kind: 'inherit' } as const;
  const prior = capturedReview('approval-a', {
    kind: 'agent',
    agentId: 'agent-a',
  });
  const identity = {
    approvalId: prior.approvalId,
    runId: prior.runId,
    reviewer: prior.reviewer,
  };

  it.each([
    [
      'inherited agent',
      inherit,
      inherit,
      { kind: 'agent', agentId: 'agent-b' },
    ],
    [
      'agent to human',
      inherit,
      { kind: 'user', userId: 'u-bob' },
      { kind: 'user', userId: 'u-bob' },
    ],
    [
      'explicit agent',
      { kind: 'agent', agentId: 'agent-a' },
      { kind: 'agent', agentId: 'agent-b' },
      { kind: 'agent', agentId: 'agent-b' },
    ],
    [
      'explicit human',
      { kind: 'user', userId: 'u-alice' },
      { kind: 'user', userId: 'u-bob' },
      { kind: 'user', userId: 'u-bob' },
    ],
  ] as const)(
    'records configured choice and captured identity for %s',
    async (_name, before, after, recipient) => {
      const next = capturedReview('approval-b', recipient);
      vi.mocked(getPendingReviewForTask).mockResolvedValue(next);
      vi.mocked(loadProjectOrThrow).mockResolvedValue({
        ...project,
        defaultTaskReviewerAgentId: 'agent-b',
      });
      const priorIdentity =
        before.kind === 'user' ? { ...identity, reviewer: before } : identity;
      const tx = fakeTx(
        taskRow({
          reviewerUserId: before.kind === 'user' ? before.userId : null,
          reviewerAgentId: before.kind === 'agent' ? before.agentId : null,
        }),
      );
      await setTaskReviewer(tx, auth, 't-1', {
        reviewer: after,
        expected: { reviewer: before, pendingReview: priorIdentity },
      });
      const fromValue = JSON.stringify({
        reviewer: before,
        pendingReview: priorIdentity,
      });
      const nextIdentity = {
        approvalId: next.approvalId,
        runId: next.runId,
        reviewer: next.reviewer,
      };
      const toValue = JSON.stringify({
        reviewer: after,
        pendingReview: nextIdentity,
      });
      expect(activityValues).toHaveLength(1);
      expect(activityValues[0]).toEqual(
        expect.arrayContaining(['reviewer.changed', fromValue, toValue]),
      );
      expect(createAuditLog).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          previousState: {
            reviewer: before,
            approvalId: prior.approvalId,
            pendingReview: priorIdentity,
          },
          newState: {
            reviewer: after,
            approvalId: next.approvalId,
            pendingReview: nextIdentity,
          },
        }),
      );
    },
  );

  it('records nothing when reselecting inheritance keeps the same captured review', async () => {
    vi.mocked(getPendingReviewForTask).mockResolvedValue(prior);
    await setTaskReviewer(
      fakeTx(taskRow({ reviewerUserId: null })),
      auth,
      't-1',
      {
        reviewer: inherit,
        expected: { reviewer: inherit, pendingReview: identity },
      },
    );
    expect(activityValues).toEqual([]);
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('keeps ordinary configured-choice edits in the prior typed format without a handoff', async () => {
    const tx = fakeTx(taskRow({ reviewerUserId: null }));
    const next = { kind: 'user', userId: 'u-bob' } as const;
    await setTaskReviewer(tx, auth, 't-1', {
      reviewer: next,
      expected: { reviewer: inherit, pendingReview: null },
    });
    expect(activityValues).toHaveLength(1);
    expect(activityValues[0]).toEqual(
      expect.arrayContaining([JSON.stringify(inherit), JSON.stringify(next)]),
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        previousState: {
          reviewer: inherit,
          approvalId: null,
          pendingReview: null,
        },
        newState: { reviewer: next, approvalId: null, pendingReview: null },
      }),
    );
  });

  it('records nothing when the configured choice fails CAS before replacing a review', async () => {
    await expect(
      setTaskReviewer(fakeTx(taskRow()), auth, 't-1', {
        reviewer: inherit,
        expected: { reviewer: inherit, pendingReview: identity },
      }),
    ).rejects.toMatchObject({ code: 'TASK_REVIEWER_STALE' });
    expect(replacePendingTaskReviewer).not.toHaveBeenCalled();
    expect(activityValues).toEqual([]);
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('records nothing when the captured identity fails CAS', async () => {
    vi.mocked(replacePendingTaskReviewer).mockRejectedValue(
      Object.assign(new Error('stale'), { code: 'TASK_REVIEWER_STALE' }),
    );
    await expect(
      setTaskReviewer(fakeTx(taskRow({ reviewerUserId: null })), auth, 't-1', {
        reviewer: inherit,
        expected: { reviewer: inherit, pendingReview: identity },
      }),
    ).rejects.toMatchObject({ code: 'TASK_REVIEWER_STALE' });
    expect(activityValues).toEqual([]);
    expect(createAuditLog).not.toHaveBeenCalled();
  });
});

describe('updateTask — the open review follows the reviewer', () => {
  it.each([null, 'u-bob'])(
    'refuses a member changing the reviewer on their own task to %s',
    async (reviewerUserId) => {
      const tx = fakeTx(taskRow({ createdBy: auth.userId }));
      await expect(
        updateTask(
          tx,
          { ...auth, role: 'member' },
          { taskId: 't-1', reviewerUserId },
        ),
      ).rejects.toMatchObject({ code: 'RBAC_FORBIDDEN', status: 403 });
      expect(retargetPendingTaskReview).not.toHaveBeenCalled();
    },
  );

  it('keeps ordinary member edits with an unchanged reviewer working', async () => {
    const tx = fakeTx(taskRow({ createdBy: auth.userId }));
    await expect(
      updateTask(
        tx,
        { ...auth, role: 'member' },
        { taskId: 't-1', reviewerUserId: 'u-alice', title: 'Member edit' },
      ),
    ).resolves.toBeUndefined();
    expect(retargetPendingTaskReview).not.toHaveBeenCalled();
  });
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
      agentReviewBlockedReason: 'source_required',
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
