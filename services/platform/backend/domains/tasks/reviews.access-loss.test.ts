import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  findOrganizationMember,
  getUserTeamIds,
} from '../../auth/membership.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import {
  autoSubscribe,
  dismissReviewerAssignedNotifications,
  dismissReviewRequestNotifications,
  notifyTaskReviewRequested,
} from '../collab/service.ts';
import {
  type ApprovalRow,
  retargetPendingTaskReviewsForUser,
} from './reviews.ts';

vi.mock('../../auth/membership.ts', () => ({
  findOrganizationMember: vi.fn(),
  getUserTeamIds: vi.fn(() => Promise.resolve([])),
}));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../collab/service.ts', () => ({
  autoSubscribe: vi.fn(),
  dismissReviewerAssignedNotifications: vi.fn(),
  dismissReviewRequestNotifications: vi.fn(),
  notifyTaskReviewRequested: vi.fn(),
}));

/**
 * A person who can no longer edit a project is still the reviewer on its
 * tasks: the designation names them and the open request waits on them, so
 * nobody who can act is asked. `retargetPendingTaskReviewsForUser` runs in
 * the transaction that took the access away and hands those reviews on — and
 * only those, only when the access is really gone. The fake transaction
 * answers the helper's own reads (candidates, the locked task, its approvals,
 * the project) and records every statement; what the real SQL keeps apart
 * (other organizations, decided and workflow rows) is proven against
 * Postgres by `review-access-loss.integration.ts`.
 */

interface TaskFixture {
  id: string;
  projectId?: string;
  title?: string;
  reviewerUserId?: string | null;
  createdBy?: string;
  archivedAt?: number | null;
}

interface Statement {
  text: string;
  values: unknown[];
}

/** Org roles by user: editors hold project canEdit, `member` does not,
 * `disabled` is nobody. A user absent here is not a member. */
let roles: Record<string, string> = {};
let userTeams: string[] = [];

function approval(
  taskId: string,
  metadata: Record<string, unknown>,
  overrides: Partial<ApprovalRow> = {},
): ApprovalRow {
  return {
    id: `apv-${taskId}`,
    organizationId: 'org-1',
    status: 'pending',
    wfExecutionId: null,
    approvedBy: null,
    reviewedAt: null,
    metadata: {
      taskId,
      projectId: 'p-1',
      round: 0,
      question: null,
      ...metadata,
    },
    createdAt: 1,
    ...overrides,
  };
}

function setup(args: {
  tasks: TaskFixture[];
  approvals?: ApprovalRow[];
  project?: { createdBy: string; teamIds: string[] | null };
  /** What the read before the lock found; defaults to every task. */
  candidates?: { id: string; projectId: string }[];
}): { tx: TransactionSql; statements: Statement[] } {
  const statements: Statement[] = [];
  const project = args.project ?? { createdBy: 'u-lead', teamIds: [] };
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (
      text.startsWith('SELECT id, project_id AS "projectId" FROM app.tasks')
    ) {
      return Promise.resolve(
        args.candidates ??
          args.tasks.map((task) => ({
            id: task.id,
            projectId: task.projectId ?? 'p-1',
          })),
      );
    }
    if (
      text.includes('FROM app.tasks WHERE id = ? AND org_id = ? FOR UPDATE')
    ) {
      const task = args.tasks.find((candidate) => candidate.id === values[0]);
      return Promise.resolve(
        task === undefined
          ? []
          : [
              {
                id: task.id,
                organizationId: 'org-1',
                projectId: task.projectId ?? 'p-1',
                title: task.title ?? `Task ${task.id}`,
                reviewerUserId: task.reviewerUserId ?? null,
                createdBy: task.createdBy ?? 'u-carol',
                createdByType: 'user',
                archivedAt: task.archivedAt ?? null,
              },
            ],
      );
    }
    if (text.includes('FROM app.approvals')) {
      return Promise.resolve(
        (args.approvals ?? []).filter(
          // The task id is the statement's last value (the column list the
          // gate splices in comes first).
          (candidate) => candidate.metadata?.taskId === values.at(-1),
        ),
      );
    }
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

const writes = (statements: Statement[]) =>
  statements.filter((statement) =>
    /^(UPDATE|INSERT|DELETE)/.test(statement.text),
  );

const lostAccess = {
  organizationId: 'org-1',
  userId: 'u-bob',
  cause: 'role_changed',
} as const;

beforeEach(() => {
  roles = {
    'u-alice': 'editor',
    'u-bob': 'member',
    'u-carol': 'editor',
    'u-lead': 'admin',
  };
  userTeams = [];
  vi.mocked(findOrganizationMember)
    .mockReset()
    .mockImplementation((_sql, organizationId, userId) => {
      const role = roles[userId];
      return Promise.resolve(
        role === undefined
          ? null
          : { id: `m-${userId}`, organizationId, userId, role },
      );
    });
  vi.mocked(getUserTeamIds)
    .mockReset()
    .mockImplementation(() => Promise.resolve(userTeams));
  vi.mocked(emitHintInTx).mockReset();
  vi.mocked(createAuditLog).mockReset();
  vi.mocked(autoSubscribe).mockReset();
  vi.mocked(dismissReviewerAssignedNotifications).mockReset();
  vi.mocked(dismissReviewRequestNotifications).mockReset();
  vi.mocked(notifyTaskReviewRequested).mockReset();
});

describe('retargetPendingTaskReviewsForUser — who keeps a review [TASK-R39]', () => {
  it('reads and writes nothing more when no task waits on the person', async () => {
    const { tx, statements } = setup({ tasks: [], candidates: [] });
    await retargetPendingTaskReviewsForUser(tx, lostAccess);
    expect(statements).toHaveLength(1);
    expect(writes(statements)).toEqual([]);
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(emitHintInTx).not.toHaveBeenCalled();
  });

  it.each([
    ['an admin role keeps edit access everywhere', 'admin', []],
    ['an editor role reaches an organization-wide project', 'editor', []],
    ['another team still reaches a restricted project', 'editor', ['team-b']],
  ])('leaves the review alone when %s', async (_name, role, teams) => {
    roles['u-bob'] = role;
    userTeams = teams;
    const { tx, statements } = setup({
      tasks: [{ id: 't-1', reviewerUserId: 'u-bob' }],
      approvals: [approval('t-1', { requestedFor: 'u-bob' })],
      project: {
        createdBy: 'u-lead',
        teamIds: teams.length === 0 ? [] : ['team-a', 'team-b'],
      },
    });
    await retargetPendingTaskReviewsForUser(tx, lostAccess);
    expect(writes(statements)).toEqual([]);
    expect(
      statements.some((statement) => statement.text.includes('FOR UPDATE')),
    ).toBe(false);
    expect(notifyTaskReviewRequested).not.toHaveBeenCalled();
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(emitHintInTx).not.toHaveBeenCalled();
  });

  it('hands the review on when no team that reaches the project is left', async () => {
    roles['u-bob'] = 'editor';
    userTeams = ['team-elsewhere'];
    const { tx, statements } = setup({
      tasks: [{ id: 't-1', reviewerUserId: 'u-bob' }],
      approvals: [approval('t-1', { requestedFor: 'u-bob' })],
      project: { createdBy: 'u-lead', teamIds: ['team-a'] },
    });
    await retargetPendingTaskReviewsForUser(tx, {
      ...lostAccess,
      cause: 'team_removed',
    });
    expect(
      writes(statements).map((statement) => statement.text.split(' SET')[0]),
    ).toContain('UPDATE app.tasks');
    // The task's creator reaches the project no more than the person does:
    // the chain ends at the admin, who reaches every project.
    expect(notifyTaskReviewRequested).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ reviewerUserId: 'u-lead' }),
    );
  });

  it('reads the person and their project once, however many of its tasks wait', async () => {
    const { tx } = setup({
      tasks: [
        { id: 't-1', reviewerUserId: 'u-bob' },
        { id: 't-2', reviewerUserId: 'u-bob' },
        { id: 't-3', reviewerUserId: 'u-bob' },
      ],
    });
    await retargetPendingTaskReviewsForUser(tx, lostAccess);
    expect(findOrganizationMember).toHaveBeenCalledTimes(1);
    expect(getUserTeamIds).toHaveBeenCalledTimes(1);
    expect(createAuditLog).toHaveBeenCalledTimes(3);
  });
});

describe('retargetPendingTaskReviewsForUser — a lost designation [TASK-R39]', () => {
  it('clears the designation of a task that has no review open, and says so once', async () => {
    const { tx, statements } = setup({
      tasks: [{ id: 't-1', reviewerUserId: 'u-bob', title: 'Plan the launch' }],
    });
    await retargetPendingTaskReviewsForUser(tx, lostAccess);

    expect(
      writes(statements).map((statement) => [
        statement.text.split(' WHERE')[0],
        statement.values,
      ]),
    ).toEqual([
      [
        'UPDATE app.tasks SET reviewer_user_id = NULL, updated_at_ms = ?',
        [expect.any(Number), 't-1', 'org-1'],
      ],
    ]);
    expect(dismissReviewerAssignedNotifications).toHaveBeenCalledWith(tx, {
      organizationId: 'org-1',
      taskId: 't-1',
      userId: 'u-bob',
    });
    expect(notifyTaskReviewRequested).not.toHaveBeenCalled();
    expect(createAuditLog).toHaveBeenCalledTimes(1);
    expect(createAuditLog).toHaveBeenCalledWith(tx, {
      organizationId: 'org-1',
      actorId: 'system',
      actorType: 'system',
      action: 'task.review_retargeted',
      category: 'data',
      resourceType: 'task',
      resourceId: 't-1',
      resourceName: 'Plan the launch',
      previousState: {
        reviewerUserId: 'u-bob',
        approvalId: null,
        reviewer: null,
      },
      newState: { reviewerUserId: null, approvalId: null, reviewer: null },
      metadata: { cause: 'role_changed' },
      status: 'success',
    });
    expect(emitHintInTx).toHaveBeenCalledWith(tx, {
      orgId: 'org-1',
      entity: 'task',
      entityId: 't-1',
    });
  });

  it.each([
    ['removed from the organization', undefined],
    ['switched off', 'disabled'],
    ['lowered to Member', 'member'],
  ])('treats a person %s as having lost the project', async (_name, role) => {
    if (role === undefined) delete roles['u-bob'];
    else roles['u-bob'] = role;
    const { tx } = setup({
      tasks: [{ id: 't-1', reviewerUserId: 'u-bob' }],
    });
    await retargetPendingTaskReviewsForUser(tx, lostAccess);
    expect(createAuditLog).toHaveBeenCalledTimes(1);
  });

  it('leaves a designation alone that someone else set since the read', async () => {
    const { tx, statements } = setup({
      tasks: [{ id: 't-1', reviewerUserId: 'u-alice' }],
      candidates: [{ id: 't-1', projectId: 'p-1' }],
    });
    await retargetPendingTaskReviewsForUser(tx, lostAccess);
    expect(writes(statements)).toEqual([]);
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(emitHintInTx).not.toHaveBeenCalled();
  });

  it('skips a task that was deleted since the read', async () => {
    const { tx, statements } = setup({
      tasks: [],
      candidates: [{ id: 't-gone', projectId: 'p-1' }],
    });
    await retargetPendingTaskReviewsForUser(tx, lostAccess);
    expect(writes(statements)).toEqual([]);
    expect(createAuditLog).not.toHaveBeenCalled();
  });
});

describe('retargetPendingTaskReviewsForUser — the open review [TASK-R39]', () => {
  it('locks the task before it reads the review, then moves the review to the next reviewer and asks them', async () => {
    const { tx, statements } = setup({
      tasks: [{ id: 't-1', reviewerUserId: 'u-bob', createdBy: 'u-carol' }],
      approvals: [approval('t-1', { requestedFor: 'u-bob' })],
    });
    await retargetPendingTaskReviewsForUser(tx, lostAccess);

    const lockAt = statements.findIndex((statement) =>
      statement.text.endsWith('FOR UPDATE'),
    );
    const reviewReadAt = statements.findIndex((statement) =>
      statement.text.includes("resource_type = 'task_review' AND resource_id"),
    );
    expect(lockAt).toBeGreaterThan(-1);
    expect(reviewReadAt).toBeGreaterThan(lockAt);

    const moved = statements.find((statement) =>
      statement.text.startsWith('UPDATE app.approvals'),
    );
    expect(moved?.values).toEqual([
      {
        json: {
          requestedFor: 'u-carol',
          reviewer: { kind: 'user', userId: 'u-carol' },
        },
      },
      'apv-t-1',
    ]);
    expect(dismissReviewRequestNotifications).toHaveBeenCalledWith(tx, {
      organizationId: 'org-1',
      approvalId: 'apv-t-1',
    });
    expect(autoSubscribe).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ subscriberId: 'u-carol', reason: 'reviewer' }),
    );
    // Nobody made the change: the request reads impersonally.
    expect(notifyTaskReviewRequested).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        reviewerUserId: 'u-carol',
        approvalId: 'apv-t-1',
        submitter: { kind: 'system' },
      }),
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'task.review_retargeted',
        previousState: {
          reviewerUserId: 'u-bob',
          approvalId: 'apv-t-1',
          reviewer: { kind: 'user', userId: 'u-bob' },
        },
        newState: {
          reviewerUserId: null,
          approvalId: 'apv-t-1',
          reviewer: { kind: 'user', userId: 'u-carol' },
        },
        metadata: { cause: 'role_changed' },
      }),
    );
  });

  it('never hands the review back to the person through a creator slot', async () => {
    roles['u-bob'] = 'editor';
    userTeams = [];
    const { tx } = setup({
      tasks: [{ id: 't-1', reviewerUserId: 'u-bob', createdBy: 'u-bob' }],
      approvals: [approval('t-1', { requestedFor: 'u-bob' })],
      project: { createdBy: 'u-bob', teamIds: ['team-a'] },
    });
    roles['u-lead'] = 'admin';
    await retargetPendingTaskReviewsForUser(tx, {
      ...lostAccess,
      cause: 'team_removed',
    });
    // Task creator and project creator are both the person: nobody is left.
    expect(notifyTaskReviewRequested).not.toHaveBeenCalled();
    expect(createAuditLog).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        newState: {
          reviewerUserId: null,
          approvalId: 'apv-t-1',
          reviewer: null,
        },
      }),
    );
  });

  it('moves a review the creator fallback addressed to the person, though no designation names them', async () => {
    const { tx, statements } = setup({
      tasks: [{ id: 't-1', reviewerUserId: null, createdBy: 'u-bob' }],
      approvals: [approval('t-1', { requestedFor: 'u-bob' })],
      candidates: [{ id: 't-1', projectId: 'p-1' }],
    });
    await retargetPendingTaskReviewsForUser(tx, lostAccess);

    expect(
      statements.some((statement) =>
        statement.text.startsWith('UPDATE app.tasks'),
      ),
    ).toBe(false);
    expect(dismissReviewerAssignedNotifications).not.toHaveBeenCalled();
    expect(notifyTaskReviewRequested).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ reviewerUserId: 'u-lead' }),
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        previousState: expect.objectContaining({ reviewerUserId: null }),
        newState: expect.objectContaining({
          reviewer: { kind: 'user', userId: 'u-lead' },
        }),
      }),
    );
  });

  it('reads the typed recipient first, so a person only named by a stale mirror keeps nothing to lose', async () => {
    const { tx, statements } = setup({
      tasks: [{ id: 't-1', reviewerUserId: null }],
      approvals: [
        approval('t-1', {
          requestedFor: 'u-bob',
          reviewer: { kind: 'user', userId: 'u-alice' },
        }),
      ],
      candidates: [{ id: 't-1', projectId: 'p-1' }],
    });
    await retargetPendingTaskReviewsForUser(tx, lostAccess);
    expect(writes(statements)).toEqual([]);
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('moves a review addressed to the person by its typed recipient alone', async () => {
    const { tx } = setup({
      tasks: [{ id: 't-1', reviewerUserId: null }],
      approvals: [
        approval('t-1', { reviewer: { kind: 'user', userId: 'u-bob' } }),
      ],
      candidates: [{ id: 't-1', projectId: 'p-1' }],
    });
    await retargetPendingTaskReviewsForUser(tx, lostAccess);
    expect(createAuditLog).toHaveBeenCalledTimes(1);
    expect(notifyTaskReviewRequested).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ reviewerUserId: 'u-carol' }),
    );
  });

  it.each([
    [
      'an agent review',
      approval('t-1', {
        requestedFor: null,
        reviewer: { kind: 'agent', agentId: 'agent-1' },
      }),
    ],
    [
      'a decided review',
      approval('t-1', { requestedFor: 'u-bob' }, { status: 'completed' }),
    ],
    [
      'a withdrawn review',
      approval('t-1', { requestedFor: 'u-bob' }, { status: 'rejected' }),
    ],
    [
      'a workflow-era review',
      approval('t-1', { requestedFor: 'u-bob' }, { wfExecutionId: 'wf-1' }),
    ],
  ])('leaves %s alone while it clears the designation', async (_name, row) => {
    const { tx, statements } = setup({
      tasks: [{ id: 't-1', reviewerUserId: 'u-bob' }],
      approvals: [row],
    });
    await retargetPendingTaskReviewsForUser(tx, lostAccess);
    expect(
      statements.some((statement) =>
        statement.text.startsWith('UPDATE app.approvals'),
      ),
    ).toBe(false);
    expect(notifyTaskReviewRequested).not.toHaveBeenCalled();
    expect(createAuditLog).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        previousState: expect.objectContaining({ approvalId: null }),
      }),
    );
  });

  it('moves the review of an archived task without asking anyone, and still follows it', async () => {
    const { tx } = setup({
      tasks: [{ id: 't-1', reviewerUserId: 'u-bob', archivedAt: 5 }],
      approvals: [approval('t-1', { requestedFor: 'u-bob' })],
    });
    await retargetPendingTaskReviewsForUser(tx, lostAccess);
    expect(autoSubscribe).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ subscriberId: 'u-carol' }),
    );
    expect(notifyTaskReviewRequested).not.toHaveBeenCalled();
    expect(emitHintInTx).toHaveBeenCalledTimes(1);
  });

  it('lets the designee someone else set take the review the person leaves', async () => {
    const { tx } = setup({
      tasks: [{ id: 't-1', reviewerUserId: 'u-alice' }],
      approvals: [approval('t-1', { requestedFor: 'u-bob' })],
      candidates: [{ id: 't-1', projectId: 'p-1' }],
    });
    await retargetPendingTaskReviewsForUser(tx, lostAccess);
    expect(dismissReviewerAssignedNotifications).not.toHaveBeenCalled();
    expect(notifyTaskReviewRequested).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ reviewerUserId: 'u-alice' }),
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        previousState: expect.objectContaining({ reviewerUserId: 'u-alice' }),
        newState: expect.objectContaining({ reviewerUserId: 'u-alice' }),
      }),
    );
  });

  it('records nothing for a review that moved on after the read', async () => {
    const { tx, statements } = setup({
      tasks: [{ id: 't-1', reviewerUserId: null }],
      approvals: [approval('t-1', { requestedFor: 'u-alice' })],
      candidates: [{ id: 't-1', projectId: 'p-1' }],
    });
    await retargetPendingTaskReviewsForUser(tx, lostAccess);
    expect(writes(statements)).toEqual([]);
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(emitHintInTx).not.toHaveBeenCalled();
  });
});
