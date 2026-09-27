import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  findOrganizationMember,
  getUserTeamIds,
} from '../../auth/membership.ts';
import {
  autoSubscribe,
  dismissReviewRequestNotifications,
  notifyTaskReviewRequested,
} from '../collab/service.ts';
import {
  type ApprovalRow,
  retargetPendingTaskReview,
  reviewerEligibility,
} from './reviews.ts';
import type { TaskRow } from './service.ts';

vi.mock('../../auth/membership.ts', () => ({
  findOrganizationMember: vi.fn(),
  getUserTeamIds: vi.fn(() => Promise.resolve([])),
}));
vi.mock('../collab/service.ts', () => ({
  autoSubscribe: vi.fn(),
  dismissReviewRequestNotifications: vi.fn(),
  notifyTaskReviewRequested: vi.fn(),
}));

/**
 * A reviewer changed while the task waits In review: the open review must
 * follow, or the board chip, "Needs my review" and the actionable bell keep
 * pointing at the person the review was taken from. The fake transaction
 * answers the gate's own reads (its approvals, the project) and records
 * every statement; the collab writers are mocked so each bell is asserted.
 */

/** Org roles by user — editor roles hold project canEdit, `member` does
 * not, `disabled` is nobody. */
const ROLES: Record<string, string> = {
  'u-alice': 'editor',
  'u-bob': 'editor',
  'u-carol': 'editor',
  'u-lead': 'admin',
  'u-viewer': 'member',
  'u-gone': 'disabled',
};

function taskRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 't-1',
    organizationId: 'org-1',
    projectId: 'p-1',
    title: 'Ship the launch notes',
    description: null,
    attachments: null,
    outputs: null,
    number: 1,
    status: 'in_review',
    priority: null,
    labelIds: [],
    assigneeType: 'agent',
    assigneeId: 'agent-1',
    reviewerUserId: 'u-bob',
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
    agentRunCount: 1,
    lastAgentRunAt: null,
    claimedAt: null,
    completedAt: null,
    externalClosedAt: null,
    createdBy: 'u-carol',
    createdByType: 'user',
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    ...overrides,
  };
}

function approval(overrides: Partial<ApprovalRow> = {}): ApprovalRow {
  return {
    id: 'apv-1',
    organizationId: 'org-1',
    status: 'pending',
    wfExecutionId: null,
    approvedBy: null,
    reviewedAt: null,
    metadata: {
      taskId: 't-1',
      projectId: 'p-1',
      agentSlug: 'Launch bot',
      requestedFor: 'u-alice',
      round: 0,
      question: null,
      runId: 'run-1',
    },
    createdAt: 1,
    ...overrides,
  };
}

function fakeTx(
  approvals: ApprovalRow[],
  project: { createdBy: string; teamIds: string[] } = {
    createdBy: 'u-gone',
    teamIds: [],
  },
): { tx: TransactionSql; statements: { text: string; values: unknown[] }[] } {
  const statements: { text: string; values: unknown[] }[] = [];
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.includes('FROM app.approvals')) return Promise.resolve(approvals);
    if (text.includes('FROM app.projects')) return Promise.resolve([project]);
    return Promise.resolve([]);
  };
  const tx = Object.assign(tag, {
    json: (value: unknown) => ({ json: value }),
    unsafe: (text: string): unknown => text,
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- three-member stand-in for the postgres.js transaction function
  return { tx: tx as unknown as TransactionSql, statements };
}

function approvalWrites(
  statements: { text: string; values: unknown[] }[],
): unknown[][] {
  return statements
    .filter((statement) => statement.text.startsWith('UPDATE app.approvals'))
    .map((statement) => statement.values);
}

beforeEach(() => {
  vi.mocked(findOrganizationMember)
    .mockReset()
    .mockImplementation((_sql, organizationId, userId) => {
      const role = ROLES[userId];
      return Promise.resolve(
        role === undefined
          ? null
          : { id: `m-${userId}`, organizationId, userId, role },
      );
    });
  vi.mocked(getUserTeamIds).mockReset().mockResolvedValue([]);
  vi.mocked(autoSubscribe).mockReset();
  vi.mocked(dismissReviewRequestNotifications).mockReset();
  vi.mocked(notifyTaskReviewRequested).mockReset();
});

describe('retargetPendingTaskReview', () => {
  it('moves the open review to the new designee, bell and all, in the caller transaction', async () => {
    const { tx, statements } = fakeTx([approval()]);

    const waitsOn = await retargetPendingTaskReview(tx, {
      task: taskRow({ reviewerUserId: 'u-bob' }),
      actorUserId: 'u-lead',
    });

    expect(waitsOn).toBe('u-bob');
    // Only the routing key changes — the run link, round and driver stay,
    // and a decided row can never be rewritten.
    expect(approvalWrites(statements)).toEqual([
      [{ json: { requestedFor: 'u-bob' } }, 'apv-1'],
    ]);
    expect(
      statements.find((statement) =>
        statement.text.startsWith('UPDATE app.approvals'),
      )?.text,
    ).toContain("status = 'pending'");
    // Alice's request bell stops ringing; Bob follows the task and is asked
    // by the person who handed him the review.
    expect(dismissReviewRequestNotifications).toHaveBeenCalledWith(tx, {
      organizationId: 'org-1',
      approvalId: 'apv-1',
    });
    expect(autoSubscribe).toHaveBeenCalledWith(tx, {
      organizationId: 'org-1',
      taskId: 't-1',
      subscriberType: 'user',
      subscriberId: 'u-bob',
      reason: 'reviewer',
    });
    expect(notifyTaskReviewRequested).toHaveBeenCalledWith(tx, {
      organizationId: 'org-1',
      task: { id: 't-1', projectId: 'p-1', title: 'Ship the launch notes' },
      reviewerUserId: 'u-bob',
      approvalId: 'apv-1',
      submitter: { kind: 'user', userId: 'u-lead' },
    });
    // The old bell goes before the new one is written.
    expect(
      vi.mocked(dismissReviewRequestNotifications).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(notifyTaskReviewRequested).mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('hands a cleared review back to the resolved default — the human task creator', async () => {
    const { tx, statements } = fakeTx([approval()]);

    const waitsOn = await retargetPendingTaskReview(tx, {
      task: taskRow({ reviewerUserId: null }),
      actorUserId: 'u-lead',
    });

    expect(waitsOn).toBe('u-carol');
    expect(approvalWrites(statements)).toEqual([
      [{ json: { requestedFor: 'u-carol' } }, 'apv-1'],
    ]);
    expect(notifyTaskReviewRequested).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ reviewerUserId: 'u-carol' }),
    );
  });

  it('falls through to the project creator when the task creator was an agent', async () => {
    const { tx, statements } = fakeTx([approval()], {
      createdBy: 'u-lead',
      teamIds: [],
    });

    const waitsOn = await retargetPendingTaskReview(tx, {
      task: taskRow({
        reviewerUserId: null,
        createdBy: 'agent-1',
        createdByType: 'agent',
      }),
      actorUserId: 'u-bob',
    });

    expect(waitsOn).toBe('u-lead');
    expect(approvalWrites(statements)).toEqual([
      [{ json: { requestedFor: 'u-lead' } }, 'apv-1'],
    ]);
  });

  it('empties the request when nobody resolves, and bells nobody', async () => {
    // Agent-created task, project creator disabled: no one can take it.
    const { tx, statements } = fakeTx([approval()]);

    const waitsOn = await retargetPendingTaskReview(tx, {
      task: taskRow({
        reviewerUserId: null,
        createdBy: 'agent-1',
        createdByType: 'agent',
      }),
      actorUserId: 'u-lead',
    });

    expect(waitsOn).toBeUndefined();
    expect(approvalWrites(statements)).toEqual([
      [{ json: { requestedFor: null } }, 'apv-1'],
    ]);
    // Alice is no longer on the hook, so her bell still clears.
    expect(dismissReviewRequestNotifications).toHaveBeenCalledTimes(1);
    expect(autoSubscribe).not.toHaveBeenCalled();
    expect(notifyTaskReviewRequested).not.toHaveBeenCalled();
  });

  it('routes past a designee who cannot edit the project, as the mint does', async () => {
    const { tx, statements } = fakeTx([approval()]);

    const waitsOn = await retargetPendingTaskReview(tx, {
      task: taskRow({ reviewerUserId: 'u-viewer' }),
      actorUserId: 'u-lead',
    });

    expect(waitsOn).toBe('u-carol');
    expect(approvalWrites(statements)).toEqual([
      [{ json: { requestedFor: 'u-carol' } }, 'apv-1'],
    ]);
  });

  it('writes nothing when the open review already waits on the resolved reviewer', async () => {
    const { tx, statements } = fakeTx([
      approval({
        metadata: { taskId: 't-1', projectId: 'p-1', requestedFor: 'u-bob' },
      }),
    ]);

    const waitsOn = await retargetPendingTaskReview(tx, {
      task: taskRow({ reviewerUserId: 'u-bob' }),
      actorUserId: 'u-lead',
    });

    expect(waitsOn).toBe('u-bob');
    expect(approvalWrites(statements)).toEqual([]);
    expect(dismissReviewRequestNotifications).not.toHaveBeenCalled();
    expect(notifyTaskReviewRequested).not.toHaveBeenCalled();
  });

  it('leaves decided and workflow-era reviews alone', async () => {
    const { tx, statements } = fakeTx([
      approval({ id: 'apv-done', status: 'completed' }),
      approval({ id: 'apv-withdrawn', status: 'rejected' }),
      approval({ id: 'apv-workflow', wfExecutionId: 'wf-1' }),
    ]);

    const waitsOn = await retargetPendingTaskReview(tx, {
      task: taskRow({ reviewerUserId: 'u-bob' }),
      actorUserId: 'u-lead',
    });

    expect(waitsOn).toBeUndefined();
    expect(approvalWrites(statements)).toEqual([]);
    expect(dismissReviewRequestNotifications).not.toHaveBeenCalled();
    expect(autoSubscribe).not.toHaveBeenCalled();
    expect(notifyTaskReviewRequested).not.toHaveBeenCalled();
  });
});

/**
 * An erasure moves a review off its subject through the same chain, never
 * back to the subject: they stay a member until someone removes them, so
 * the chain would otherwise hand the review straight back through a creator
 * slot. No person made the change, so the request reads impersonally.
 */
describe('retargetPendingTaskReview — moving a review off an erased subject', () => {
  it('skips the subject in the creator slot and asks the project creator, as the system', async () => {
    const { tx, statements } = fakeTx(
      [approval({ metadata: { taskId: 't-1', requestedFor: 'u-carol' } })],
      { createdBy: 'u-lead', teamIds: [] },
    );

    const waitsOn = await retargetPendingTaskReview(tx, {
      // The erasure cleared the subject's designation first.
      task: taskRow({ reviewerUserId: null, createdBy: 'u-carol' }),
      excludeUserId: 'u-carol',
    });

    expect(waitsOn).toBe('u-lead');
    expect(approvalWrites(statements)).toEqual([
      [{ json: { requestedFor: 'u-lead' } }, 'apv-1'],
    ]);
    expect(findOrganizationMember).not.toHaveBeenCalledWith(
      tx,
      'org-1',
      'u-carol',
    );
    expect(autoSubscribe).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ subscriberId: 'u-lead', reason: 'reviewer' }),
    );
    expect(notifyTaskReviewRequested).toHaveBeenCalledWith(tx, {
      organizationId: 'org-1',
      task: { id: 't-1', projectId: 'p-1', title: 'Ship the launch notes' },
      reviewerUserId: 'u-lead',
      approvalId: 'apv-1',
      submitter: { kind: 'system' },
    });
  });

  it('empties the request when the subject is every link of the chain', async () => {
    const { tx, statements } = fakeTx(
      [approval({ metadata: { taskId: 't-1', requestedFor: 'u-carol' } })],
      { createdBy: 'u-carol', teamIds: [] },
    );

    const waitsOn = await retargetPendingTaskReview(tx, {
      task: taskRow({ reviewerUserId: null, createdBy: 'u-carol' }),
      excludeUserId: 'u-carol',
    });

    expect(waitsOn).toBeUndefined();
    expect(approvalWrites(statements)).toEqual([
      [{ json: { requestedFor: null } }, 'apv-1'],
    ]);
    expect(notifyTaskReviewRequested).not.toHaveBeenCalled();
  });
});

/**
 * The one rule a reviewer is held to — the gate resolves by it and a
 * designation is refused by it, so a designee is never stored only to be
 * routed past at mint.
 */
describe('reviewerEligibility', () => {
  const { tx } = fakeTx([]);
  const ask = (userId: string, projectTeamIds: string[] = []) =>
    reviewerEligibility(tx, {
      organizationId: 'org-1',
      projectTeamIds,
      userId,
    });

  it('takes an editor of an org-wide project', async () => {
    await expect(ask('u-bob')).resolves.toBe('eligible');
  });

  it('refuses a member whose role cannot edit', async () => {
    await expect(ask('u-viewer')).resolves.toBe('cannot_edit');
  });

  it('refuses an editor outside the teams of a team-restricted project', async () => {
    vi.mocked(getUserTeamIds).mockImplementation((_sql, _org, userId) =>
      Promise.resolve(userId === 'u-alice' ? ['team-a'] : ['team-b']),
    );
    await expect(ask('u-bob', ['team-a'])).resolves.toBe('cannot_edit');
    await expect(ask('u-alice', ['team-a'])).resolves.toBe('eligible');
    // An admin edits every project, team or not.
    await expect(ask('u-lead', ['team-a'])).resolves.toBe('eligible');
  });

  it('calls a disabled account or a non-member no member at all', async () => {
    await expect(ask('u-gone')).resolves.toBe('not_member');
    await expect(ask('u-stranger')).resolves.toBe('not_member');
  });
});
