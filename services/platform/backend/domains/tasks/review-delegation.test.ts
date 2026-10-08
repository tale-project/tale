import { randomUUID } from 'node:crypto';

import type { TaskDelegateReviewInput } from '@tale/shared/schemas/task-review';
import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { queuedOnTask } from './comments.ts';
import { delegateAgentTaskReview } from './review-delegation.ts';
import { readTaskReviewSource } from './review-evidence.ts';
import {
  agentReviewBlockedReason,
  handoffPendingTaskReview,
} from './reviews.ts';
import {
  assertTaskCreatable,
  assertTaskNotArchived,
  loadTaskOrThrow,
  recordActivity,
  taskHasLiveRun,
  type TaskRow,
} from './service.ts';

vi.mock('../projects/service.ts', () => ({
  loadProjectOrThrow: vi.fn().mockResolvedValue({ id: 'project' }),
}));
vi.mock('./comments.ts', () => ({
  queuedOnTask: vi.fn(
    (_tx: unknown, _id: string, work: () => Promise<unknown>) => work(),
  ),
}));
vi.mock('./review-evidence.ts', () => ({ readTaskReviewSource: vi.fn() }));
vi.mock('./reviews.ts', async (original) => ({
  ...(await original<typeof import('./reviews.ts')>()),
  agentReviewBlockedReason: vi.fn(),
  handoffPendingTaskReview: vi.fn(),
}));
vi.mock('./service.ts', () => ({
  assertTaskCreatable: vi.fn(),
  assertTaskNotArchived: vi.fn(),
  loadTaskOrThrow: vi.fn(),
  recordActivity: vi.fn(),
  taskHasLiveRun: vi.fn(),
}));

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

const ids = {
  task: randomUUID(),
  source: randomUUID(),
  old: randomUUID(),
  next: randomUUID(),
  manager: randomUUID(),
  from: randomUUID(),
  to: randomUUID(),
  issuer: randomUUID(),
  author: randomUUID(),
};
const auth = {
  organizationId: 'org',
  projectId: 'project',
  agentId: ids.manager,
  sessionId: 'manager-session',
  execId: 'exec',
};
const input: TaskDelegateReviewInput = {
  taskId: ids.task,
  reviewerAgentId: ids.to,
  expected: {
    approvalId: ids.old,
    runId: ids.source,
    evidenceRevision: 'a'.repeat(64),
    reviewer: { kind: 'agent', agentId: ids.from },
  },
  reason: 'Route the captured review to an available qualified reviewer.',
};
function fixture() {
  const approval = {
    id: ids.old,
    organizationId: 'org',
    status: 'pending',
    wfExecutionId: null as string | null,
    metadata: {
      projectId: 'project',
      runId: ids.source,
      reviewer: input.expected.reviewer,
    } as Record<string, unknown>,
  };
  const successor = {
    id: ids.next,
    wfExecutionId: null as string | null,
    metadata: {
      projectId: 'project',
      runId: ids.source,
      reviewer: { kind: 'agent', agentId: ids.to },
    },
  };
  const state: {
    grants: string[];
    issuer: string;
    pending: (typeof successor)[];
  } = {
    grants: ['task_delegate_review'],
    issuer: ids.issuer,
    pending: [successor],
  };
  const writes: { text: string; values: unknown[] }[] = [];
  const tag = (
    parts: TemplateStringsArray | unknown[],
    ...values: unknown[]
  ) => {
    if (!('raw' in parts)) return parts;
    const text = parts.join('?').replaceAll(/\s+/g, ' ').trim();
    if (text.includes('FROM app.project_agent_runs r'))
      return Promise.resolve(
        state.issuer === '' ? [] : [{ id: state.issuer, tools: state.grants }],
      );
    if (text.includes('FROM app.approvals'))
      return Promise.resolve(
        text.includes("status = 'pending'") ? state.pending : [approval],
      );
    if (text.startsWith('UPDATE app.approvals')) {
      writes.push({ text, values });
      Object.assign(approval.metadata, values[0]);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bounded SQL fake; the integration lane exercises real locking and writes
  const tx = Object.assign(tag, {
    json: (value: unknown) => value,
  }) as unknown as TransactionSql;
  vi.mocked(handoffPendingTaskReview).mockImplementation(async () => {
    approval.status = 'rejected';
    approval.metadata.supersededBy = ids.next;
    return ids.next;
  });
  return {
    tx,
    approval,
    successor,
    state,
    writes,
    call: (value: unknown = input, caller = auth) =>
      delegateAgentTaskReview(tx, caller, value),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadTaskOrThrow).mockResolvedValue(
    task({ id: ids.task, assigneeId: ids.author }),
  );
  vi.mocked(taskHasLiveRun).mockResolvedValue(false);
  vi.mocked(agentReviewBlockedReason).mockResolvedValue(null);
  vi.mocked(readTaskReviewSource).mockResolvedValue({
    runId: ids.source,
    implementationAgentId: ids.author,
    status: 'settled',
    settledAt: 1,
    evidenceRevision: input.expected.evidenceRevision,
  });
});

describe('TASK-R21 captured agent review delegation', () => {
  it('moves only the captured gate with source, real agent actor and durable request receipt', async () => {
    const f = fixture();
    const receipt = await f.call();
    expect(receipt).toMatchObject({
      taskId: ids.task,
      previousApprovalId: ids.old,
      approvalId: ids.next,
      runId: ids.source,
      evidenceRevision: input.expected.evidenceRevision,
      previousReviewer: input.expected.reviewer,
      reviewer: { kind: 'agent', agentId: ids.to },
      managerAgentId: ids.manager,
      issuerRunId: ids.issuer,
      reason: input.reason,
    });
    expect(handoffPendingTaskReview).toHaveBeenCalledWith(f.tx, {
      task: expect.objectContaining({
        id: ids.task,
        assigneeId: ids.author,
        reviewerAgentId: null,
      }),
      expected: input.expected,
      reviewer: receipt.reviewer,
      actor: { kind: 'agent', agentId: ids.manager },
    });
    expect(f.approval.metadata.delegationRequest).toEqual(input);
    expect(f.approval.metadata.delegation).toEqual(receipt);
    expect(f.writes).toHaveLength(1);
    expect(recordActivity).toHaveBeenCalledWith(
      f.tx,
      expect.objectContaining({
        actorType: 'agent',
        actorId: ids.manager,
        action: 'review.delegated',
      }),
    );
  });
  it('replays the same authorized issuer without a second mint or activity', async () => {
    const f = fixture();
    const first = await f.call();
    expect(await f.call()).toEqual(first);
    expect(handoffPendingTaskReview).toHaveBeenCalledTimes(1);
    expect(recordActivity).toHaveBeenCalledTimes(1);
  });
  it.each([
    'grant',
    'issuer',
    'recipient',
    'source',
    'reason',
    'superseded',
    'verdict',
    'evidence',
    'manager',
  ] as const)('refuses a replay after %s changes', async (change) => {
    const f = fixture();
    const receipt = await f.call();
    let value = input;
    if (change === 'grant') f.state.grants = [];
    if (change === 'issuer') f.state.issuer = randomUUID();
    if (change === 'recipient')
      value = { ...input, reviewerAgentId: randomUUID() };
    if (change === 'source') f.successor.metadata.runId = randomUUID();
    if (change === 'reason') value = { ...input, reason: 'Another operation' };
    if (change === 'superseded') f.successor.id = randomUUID();
    if (change === 'verdict') f.state.pending = [];
    if (change === 'evidence')
      vi.mocked(readTaskReviewSource).mockResolvedValue(null);
    if (change === 'manager')
      f.approval.metadata.delegation = {
        ...receipt,
        managerAgentId: randomUUID(),
      };
    await expect(f.call(value)).rejects.toMatchObject({
      code: change === 'grant' ? 'TASK_REVIEW_FORBIDDEN' : 'TASK_REVIEW_STALE',
    });
    expect(handoffPendingTaskReview).toHaveBeenCalledTimes(1);
    expect(f.writes).toHaveLength(1);
  });
  it.each([
    'workflow',
    'human',
    'wrong-reviewer',
    'wrong-source',
    'foreign-project',
    'changed-evidence',
    'duplicate-successors',
  ] as const)('refuses a %s gate without effects', async (change) => {
    const f = fixture();
    if (change === 'workflow') f.approval.wfExecutionId = 'workflow';
    if (change === 'human')
      f.approval.metadata.reviewer = { kind: 'user', userId: 'user' };
    if (change === 'wrong-reviewer')
      f.approval.metadata.reviewer = { kind: 'agent', agentId: randomUUID() };
    if (change === 'wrong-source') f.approval.metadata.runId = randomUUID();
    if (change === 'foreign-project') f.approval.metadata.projectId = 'other';
    if (change === 'changed-evidence')
      vi.mocked(readTaskReviewSource).mockResolvedValue(null);
    if (change === 'duplicate-successors') {
      await f.call();
      f.state.pending.push(f.successor);
    }
    await expect(f.call()).rejects.toMatchObject({ code: 'TASK_REVIEW_STALE' });
    expect(handoffPendingTaskReview).toHaveBeenCalledTimes(
      change === 'duplicate-successors' ? 1 : 0,
    );
  });
  it.each([
    ['permission_missing', 'TASK_REVIEWER_PERMISSION_MISSING'],
    ['reviewer_unavailable', 'TASK_REVIEWER_INVALID'],
    ['self_review', 'TASK_REVIEWER_NOT_INDEPENDENT'],
    ['human_policy', 'TASK_REVIEWER_HUMAN_REQUIRED'],
    ['policy_unavailable', 'GOVERNANCE_POLICY_UNAVAILABLE'],
    ['source_required', 'TASK_REVIEW_SOURCE_CHANGED'],
    ['source_changed', 'TASK_REVIEW_SOURCE_CHANGED'],
  ] as const)(
    'uses the existing eligibility and source policy refusal %s',
    async (block, code) => {
      const f = fixture();
      vi.mocked(agentReviewBlockedReason).mockResolvedValue(block);
      await expect(f.call()).rejects.toMatchObject({ code });
      expect(handoffPendingTaskReview).not.toHaveBeenCalled();
      expect(f.writes).toEqual([]);
    },
  );
  it.each([ids.manager, ids.from])(
    'refuses self-routing or unchanged recipient %s',
    async (reviewerAgentId) => {
      const f = fixture();
      await expect(f.call({ ...input, reviewerAgentId })).rejects.toMatchObject(
        { code: 'TASK_REVIEW_FORBIDDEN' },
      );
      expect(handoffPendingTaskReview).not.toHaveBeenCalled();
    },
  );
  it('requires the live grant even if the token previously contained it', async () => {
    const f = fixture();
    f.state.grants = ['task_review'];
    await expect(f.call()).rejects.toMatchObject({
      code: 'TASK_REVIEW_FORBIDDEN',
    });
    expect(loadTaskOrThrow).not.toHaveBeenCalled();
  });
  it.each([
    ['still assigned', ids.author],
    ['since reassigned', randomUUID()],
  ])(
    'refuses the captured source implementation agent as the delegating caller (%s)',
    async (_assignment, assigneeId) => {
      vi.mocked(loadTaskOrThrow).mockResolvedValue(
        task({ id: ids.task, assigneeId }),
      );
      const f = fixture();
      await expect(
        f.call(input, { ...auth, agentId: ids.author }),
      ).rejects.toMatchObject({
        code: 'TASK_REVIEWER_NOT_INDEPENDENT',
        status: 403,
        message:
          'The implementation agent cannot delegate the review of its own work',
      });
      expect(agentReviewBlockedReason).not.toHaveBeenCalled();
      expect(handoffPendingTaskReview).not.toHaveBeenCalled();
      expect(recordActivity).not.toHaveBeenCalled();
      expect(f.writes).toEqual([]);
    },
  );
  it('refuses a task of another project before it queues or reads the gate', async () => {
    vi.mocked(loadTaskOrThrow).mockResolvedValue(
      task({ id: ids.task, assigneeId: ids.author, projectId: 'other' }),
    );
    const f = fixture();
    await expect(f.call()).rejects.toMatchObject({
      code: 'TASK_REVIEW_FORBIDDEN',
      status: 403,
      message: 'The task is outside this project',
    });
    expect(queuedOnTask).not.toHaveBeenCalled();
    expect(readTaskReviewSource).not.toHaveBeenCalled();
    expect(handoffPendingTaskReview).not.toHaveBeenCalled();
    expect(f.writes).toEqual([]);
  });
  it('refuses protected live work and asks before any handoff', async () => {
    const f = fixture();
    vi.mocked(taskHasLiveRun).mockResolvedValue(true);
    await expect(f.call()).rejects.toMatchObject({ code: 'TASK_REVIEW_BUSY' });
    expect(handoffPendingTaskReview).not.toHaveBeenCalled();
    expect(assertTaskNotArchived).toHaveBeenCalled();
    expect(assertTaskCreatable).toHaveBeenCalled();
  });
});
