import type {
  PendingReviewIdentity,
  TaskReviewRecipient,
} from '@tale/shared/schemas/task-review';
import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  findOrganizationMember,
  getUserTeamIds,
} from '../../auth/membership.ts';
import { ConfigurationError } from '../../core/lib/config_store/precondition.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import {
  autoSubscribe,
  dismissReviewRequestNotifications,
  notifyTaskReviewRequested,
} from '../collab/service.ts';
import {
  type ApprovalRow,
  closePendingTaskReviewOnStatusLeave,
  getPendingReviewForTask,
  replacePendingTaskReviewer,
  requestTaskReview,
  retargetPendingTaskReview,
  taskReviewRecipientOf,
} from './reviews.ts';
import type { TaskRow } from './service.ts';

vi.mock('../../auth/membership.ts', () => ({
  findOrganizationMember: vi.fn(),
  getUserTeamIds: vi.fn(),
}));
vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: vi.fn(),
}));
vi.mock('../collab/service.ts', () => ({
  autoSubscribe: vi.fn(),
  dismissReviewRequestNotifications: vi.fn(),
  notifyTaskReviewRequested: vi.fn(),
}));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));

function task(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 'task',
    organizationId: 'org',
    projectId: 'project',
    title: 'Review work',
    description: null,
    attachments: null,
    outputs: null,
    number: 1,
    status: 'in_review',
    priority: null,
    labelIds: [],
    assigneeType: 'agent',
    assigneeId: 'author',
    reviewerUserId: null,
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
    agentRunCount: 1,
    lastAgentRunAt: null,
    claimedAt: null,
    completedAt: null,
    externalClosedAt: null,
    repeat: null,
    repeatNextTaskId: null,
    repeatContinued: false,
    createdByType: 'user',
    createdBy: 'creator',
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    ...overrides,
  };
}

function approval(reviewer?: TaskReviewRecipient | null): ApprovalRow {
  return {
    id: 'old',
    organizationId: 'org',
    status: 'pending',
    wfExecutionId: null,
    approvedBy: null,
    reviewedAt: null,
    createdAt: 1,
    metadata: {
      taskId: 'task',
      projectId: 'project',
      runId: 'run',
      round: 0,
      requestedFor: reviewer?.kind === 'agent' ? null : 'creator',
      ...(reviewer !== undefined ? { reviewer } : {}),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fixture(
  options: {
    approvals?: ApprovalRow[];
    projectAgent?: string | null;
    source?: { id: string; agentId: string; status: string } | null;
    agentTools?: string[] | null;
    currentTask?: Partial<TaskRow>;
  } = {},
) {
  const rows = [...(options.approvals ?? [])];
  const writes: string[] = [];
  const source =
    options.source === undefined
      ? { id: 'run', agentId: 'author', status: 'settled' }
      : options.source;
  const tag = (parts: TemplateStringsArray, ...values: unknown[]) => {
    const text = parts.join('?').replaceAll(/\s+/g, ' ').trim();
    if (text.startsWith('SELECT') && text.includes('FROM app.approvals')) {
      return Promise.resolve(
        text.includes("status = 'pending'")
          ? rows.filter((row) => row.status === 'pending')
          : [...rows],
      );
    }
    if (text.includes('FROM app.projects')) {
      return Promise.resolve([
        {
          agentId: options.projectAgent ?? null,
          createdBy: 'project-creator',
          teamIds: [],
        },
      ]);
    }
    if (text.includes('FROM app.project_agent_runs'))
      return Promise.resolve(
        source === null
          ? []
          : [
              {
                ...source,
                runId: source.id,
                implementationAgentId: source.agentId,
                settledAt: 1,
                evidenceRevision: 'a'.repeat(64),
              },
            ],
      );
    if (text.includes('FROM app.project_agents'))
      return Promise.resolve(
        options.agentTools === null
          ? []
          : [
              {
                name: 'Implementation agent',
                tools: options.agentTools ?? ['task_review'],
              },
            ],
      );
    if (text.includes('FROM app.tasks'))
      return Promise.resolve([task(options.currentTask)]);
    if (text.startsWith('INSERT INTO app.approvals')) {
      writes.push(text);
      const parsed = values[2];
      if (!isRecord(parsed)) throw new Error('Missing captured metadata');
      rows.unshift({
        ...approval(),
        id: `new-${rows.length}`,
        metadata: parsed,
      });
      return Promise.resolve([{ id: rows[0]?.id }]);
    }
    if (text.startsWith('UPDATE app.approvals')) {
      writes.push(text);
      const id = values.at(-1);
      const row = rows.find((candidate) => candidate.id === id);
      const metadata = values.find(
        (value): value is Record<string, unknown> =>
          value !== null && typeof value === 'object',
      );
      if (row !== undefined) {
        row.status = text.includes("status = 'completed'")
          ? 'completed'
          : 'rejected';
        row.metadata = { ...row.metadata, ...metadata };
      }
    }
    return Promise.resolve([]);
  };
  const tx = Object.assign(tag, {
    json: (value: unknown) => value,
    unsafe: (value: string) => value,
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the postgres.js members reached by the actual review domain
  return { tx: tx as unknown as TransactionSql, rows, writes };
}

const expected: PendingReviewIdentity = {
  approvalId: 'old',
  runId: 'run',
  reviewer: { kind: 'user', userId: 'creator' },
};

beforeEach(() => {
  vi.mocked(findOrganizationMember).mockImplementation(
    (_sql, organizationId, userId) =>
      Promise.resolve({
        id: `member-${userId}`,
        organizationId,
        userId,
        role: 'editor',
      }),
  );
  vi.mocked(getUserTeamIds).mockResolvedValue([]);
  vi.mocked(readGovernancePolicyForOrg).mockResolvedValue(null);
  vi.mocked(autoSubscribe).mockClear();
  vi.mocked(dismissReviewRequestNotifications).mockClear();
  vi.mocked(notifyTaskReviewRequested).mockClear();
});

describe('captured independent-agent review routing', () => {
  it('preserves the human creator default without project opt-in', async () => {
    const { tx, rows } = fixture();
    await requestTaskReview(tx, {
      task: task(),
      trigger: { kind: 'agent_run', runId: 'run' },
    });
    expect(taskReviewRecipientOf(rows[0]?.metadata ?? null)).toEqual({
      kind: 'user',
      userId: 'creator',
    });
    expect(notifyTaskReviewRequested).toHaveBeenCalledOnce();
  });

  it('keeps an explicit human override above the project agent default', async () => {
    const { tx, rows } = fixture({ projectAgent: 'reviewer' });
    await requestTaskReview(tx, {
      task: task({ reviewerUserId: 'person' }),
      trigger: { kind: 'agent_run', runId: 'run' },
    });
    expect(taskReviewRecipientOf(rows[0]?.metadata ?? null)).toEqual({
      kind: 'user',
      userId: 'person',
    });
  });

  it.each([
    { kind: 'human' as const, actorId: 'creator' },
    { kind: 'automation' as const, slug: 'scheduled-work' },
  ])(
    'keeps source-less $kind submissions on the human chain',
    async (trigger) => {
      for (const reviewerAgentId of [null, 'reviewer']) {
        const { tx, rows } = fixture({
          projectAgent: 'reviewer',
          source: null,
        });
        await requestTaskReview(tx, {
          task: task({ reviewerAgentId }),
          trigger,
        });
        expect(taskReviewRecipientOf(rows[0]?.metadata ?? null)).toEqual({
          kind: 'user',
          userId: 'creator',
        });
        expect(rows[0]?.metadata?.runId).toBeUndefined();
        expect(notifyTaskReviewRequested).toHaveBeenCalledWith(
          tx,
          expect.objectContaining({ reviewerUserId: 'creator' }),
        );
      }
    },
  );

  it.each([
    { requireIndependentReviewer: true, requiredCompetences: [] },
    { requireIndependentReviewer: false, requiredCompetences: ['review'] },
  ])(
    'routes a new governed native review through the human chain %j',
    async (policy) => {
      vi.mocked(readGovernancePolicyForOrg).mockResolvedValue(policy);
      const { tx, rows } = fixture({ projectAgent: 'reviewer' });
      await requestTaskReview(tx, {
        task: task(),
        trigger: { kind: 'agent_run', runId: 'run' },
      });
      expect(taskReviewRecipientOf(rows[0]?.metadata ?? null)).toEqual({
        kind: 'user',
        userId: 'creator',
      });
      expect(rows[0]?.metadata?.runId).toBe('run');
      expect(notifyTaskReviewRequested).toHaveBeenCalledOnce();
    },
  );

  it.each([
    { projectAgent: 'reviewer', reviewerAgentId: null },
    { projectAgent: null, reviewerAgentId: 'reviewer' },
    { projectAgent: 'other', reviewerAgentId: 'deleted-agent' },
  ])(
    'captures agent intent without any person bell or subscription %j',
    async ({ projectAgent, reviewerAgentId }) => {
      const { tx, rows } = fixture({ projectAgent });
      await requestTaskReview(tx, {
        task: task({ reviewerAgentId }),
        trigger: { kind: 'agent_run', runId: 'run' },
      });
      expect(taskReviewRecipientOf(rows[0]?.metadata ?? null)).toEqual({
        kind: 'agent',
        agentId: reviewerAgentId ?? projectAgent,
      });
      expect(rows[0]?.metadata?.requestedFor).toBeNull();
      expect(autoSubscribe).not.toHaveBeenCalled();
      expect(notifyTaskReviewRequested).not.toHaveBeenCalled();
    },
  );

  it('does not silently move an existing review after a project default change', async () => {
    const { tx, rows } = fixture({
      approvals: [approval()],
      projectAgent: 'reviewer',
    });
    expect(
      (await getPendingReviewForTask(tx, 'org', 'task'))?.reviewer,
    ).toEqual(expected.reviewer);
    expect(
      await requestTaskReview(tx, {
        task: task(),
        trigger: { kind: 'agent_run', runId: 'run' },
      }),
    ).toEqual({ approvalId: 'old', minted: false });
    expect(rows).toHaveLength(1);
  });

  it.each([
    { agentTools: null, reason: 'reviewer_unavailable' },
    { agentTools: [], reason: 'permission_missing' },
    { source: null, reason: 'source_required' },
    {
      source: { id: 'run', agentId: 'reviewer', status: 'settled' },
      reason: 'self_review',
    },
    { currentTask: { assigneeId: 'other' }, reason: 'source_changed' },
  ])(
    'keeps a captured agent and exposes $reason without a human bell',
    async ({ reason, ...options }) => {
      const { tx, rows, writes } = fixture({
        ...options,
        approvals: [approval({ kind: 'agent', agentId: 'reviewer' })],
      });
      const review = await getPendingReviewForTask(tx, 'org', 'task');
      expect(review?.reviewer).toEqual({ kind: 'agent', agentId: 'reviewer' });
      expect(review?.agentReviewBlockedReason).toBe(reason);
      expect(rows).toHaveLength(1);
      expect(writes).toEqual([]);
      expect(notifyTaskReviewRequested).not.toHaveBeenCalled();
    },
  );

  it('settles with its configured agent if policy is unreadable and exposes recovery', async () => {
    vi.mocked(readGovernancePolicyForOrg).mockRejectedValue(
      new ConfigurationError('GOVERNANCE_POLICY_INVALID', 'Invalid policy'),
    );
    const { tx, rows } = fixture({ projectAgent: 'reviewer' });
    await requestTaskReview(tx, {
      task: task(),
      trigger: { kind: 'agent_run', runId: 'run' },
    });
    expect(rows[0]?.metadata?.reviewer).toEqual({
      kind: 'agent',
      agentId: 'reviewer',
    });
    expect(
      (await getPendingReviewForTask(tx, 'org', 'task'))
        ?.agentReviewBlockedReason,
    ).toBe('policy_unavailable');
    expect(notifyTaskReviewRequested).not.toHaveBeenCalled();
  });

  it('reports a policy added after capture without silently handing the review to a person', async () => {
    vi.mocked(readGovernancePolicyForOrg).mockResolvedValue({
      requireIndependentReviewer: true,
    });
    const { tx, writes } = fixture({
      approvals: [approval({ kind: 'agent', agentId: 'reviewer' })],
    });
    expect(await getPendingReviewForTask(tx, 'org', 'task')).toMatchObject({
      reviewer: { kind: 'agent', agentId: 'reviewer' },
      agentReviewBlockedReason: 'human_policy',
    });
    expect(writes).toEqual([]);
  });

  it.each([
    { agentTools: [], code: 'TASK_REVIEWER_PERMISSION_MISSING' },
    { agentTools: null, code: 'TASK_REVIEWER_INVALID' },
    {
      currentTask: { assigneeId: 'other' },
      code: 'TASK_REVIEW_SOURCE_CHANGED',
    },
  ])(
    'refuses an invalid explicit handoff with no history writes: $code',
    async ({ code, ...options }) => {
      const { tx, writes } = fixture({ ...options, approvals: [approval()] });
      await expect(
        replacePendingTaskReviewer(tx, {
          task: task({ reviewerAgentId: 'reviewer' }),
          expected,
          actorUserId: 'editor',
        }),
      ).rejects.toMatchObject({ code });
      expect(writes).toEqual([]);
    },
  );

  it('refuses explicit agent transfer under human policy instead of rerouting it', async () => {
    vi.mocked(readGovernancePolicyForOrg).mockResolvedValue({
      requiredCompetences: ['review'],
    });
    const { tx, writes } = fixture({ approvals: [approval()] });
    await expect(
      replacePendingTaskReviewer(tx, {
        task: task({ reviewerAgentId: 'reviewer' }),
        expected,
        actorUserId: 'editor',
      }),
    ).rejects.toMatchObject({ code: 'TASK_REVIEWER_HUMAN_REQUIRED' });
    expect(writes).toEqual([]);
  });

  it('supersedes a human review, retains exact source history, and replays settle to its successor', async () => {
    const { tx, rows } = fixture({ approvals: [approval()] });
    const nextTask = task({ reviewerAgentId: 'reviewer' });
    await replacePendingTaskReviewer(tx, {
      task: nextTask,
      expected,
      actorUserId: 'editor',
    });
    expect(rows).toHaveLength(2);
    expect(rows[1]?.status).toBe('rejected');
    expect(rows[1]?.metadata?.supersededBy).toBe(rows[0]?.id);
    expect(rows[0]?.metadata).toMatchObject({
      runId: 'run',
      reviewer: { kind: 'agent', agentId: 'reviewer' },
      requestedFor: null,
    });
    expect(
      await requestTaskReview(tx, {
        task: nextTask,
        trigger: { kind: 'agent_run', runId: 'run' },
      }),
    ).toEqual({ approvalId: rows[0]?.id, minted: false });
    expect(dismissReviewRequestNotifications).toHaveBeenCalledWith(tx, {
      organizationId: 'org',
      approvalId: 'old',
    });
    expect(notifyTaskReviewRequested).not.toHaveBeenCalled();
    expect(nextTask.status).toBe('in_review');
    expect(nextTask.assigneeId).toBe('author');
  });

  it.each([
    null,
    { ...expected, approvalId: 'stale' },
    { ...expected, runId: 'stale' },
    { ...expected, reviewer: { kind: 'agent' as const, agentId: 'stale' } },
  ])('rejects stale captured identity with no review write %j', async (old) => {
    const { tx, writes } = fixture({ approvals: [approval()] });
    await expect(
      replacePendingTaskReviewer(tx, {
        task: task({ reviewerAgentId: 'reviewer' }),
        expected: old,
        actorUserId: 'editor',
      }),
    ).rejects.toMatchObject({ code: 'TASK_REVIEWER_STALE' });
    expect(writes).toEqual([]);
  });

  it.each([
    { id: 'newer', agentId: 'author', status: 'settled' },
    { id: 'run', agentId: 'author', status: 'running' },
    { id: 'run', agentId: 'author', status: 'failed' },
    null,
  ])('requires the latest settled implementation source %j', async (source) => {
    const { tx, writes } = fixture({ approvals: [approval()], source });
    await expect(
      replacePendingTaskReviewer(tx, {
        task: task({ reviewerAgentId: 'reviewer' }),
        expected,
        actorUserId: 'editor',
      }),
    ).rejects.toMatchObject({ code: 'TASK_REVIEW_SOURCE_REQUIRED' });
    expect(writes).toEqual([]);
  });

  it('refuses self-review using source agent identity even when current assignee differs', async () => {
    const { tx, writes } = fixture({ approvals: [approval()] });
    await expect(
      replacePendingTaskReviewer(tx, {
        task: task({ assigneeId: 'other', reviewerAgentId: 'author' }),
        expected,
        actorUserId: 'editor',
      }),
    ).rejects.toMatchObject({ code: 'TASK_REVIEWER_NOT_INDEPENDENT' });
    expect(writes).toEqual([]);
  });

  it.each([
    { kind: 'user' as const, userId: 'creator' },
    { kind: 'system' as const, actorId: 'sync' },
  ])(
    'refuses stale or generic Done for captured agent ownership %j',
    async (actor) => {
      const { tx, writes } = fixture({
        approvals: [approval({ kind: 'agent', agentId: 'reviewer' })],
      });
      await expect(
        closePendingTaskReviewOnStatusLeave(tx, {
          task: task(),
          toStatus: 'done',
          actor,
        }),
      ).rejects.toMatchObject({ code: 'TASK_AGENT_REVIEW_REQUIRED' });
      expect(writes).toEqual([]);
    },
  );

  it('leaves captured agent intent intact during human erasure retargeting', async () => {
    const { tx, writes } = fixture({
      approvals: [approval({ kind: 'agent', agentId: 'deleted-agent' })],
    });
    await retargetPendingTaskReview(tx, {
      task: task(),
      excludeUserId: 'creator',
    });
    expect(writes).toEqual([]);
    expect(notifyTaskReviewRequested).not.toHaveBeenCalled();
  });

  it('can explicitly hand agent ownership back to a person without approving', async () => {
    const agent = { kind: 'agent' as const, agentId: 'reviewer' };
    const { tx, rows } = fixture({ approvals: [approval(agent)] });
    await replacePendingTaskReviewer(tx, {
      task: task({ reviewerUserId: 'person' }),
      expected: { ...expected, reviewer: agent },
      actorUserId: 'editor',
    });
    expect(rows[0]?.status).toBe('pending');
    expect(rows[1]?.status).toBe('rejected');
    expect(rows[0]?.approvedBy).toBeNull();
    expect(notifyTaskReviewRequested).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ reviewerUserId: 'person' }),
    );
  });

  it('never treats a typed agent or explicit empty recipient as legacy person ownership', () => {
    expect(
      taskReviewRecipientOf({
        reviewer: { kind: 'agent', agentId: 'reviewer' },
        requestedFor: 'person',
      }),
    ).toEqual({ kind: 'agent', agentId: 'reviewer' });
    expect(
      taskReviewRecipientOf({ reviewer: null, requestedFor: 'person' }),
    ).toBeNull();
    expect(taskReviewRecipientOf({ requestedFor: 'person' })).toEqual({
      kind: 'user',
      userId: 'person',
    });
  });
});
