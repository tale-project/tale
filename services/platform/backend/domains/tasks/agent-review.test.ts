import type { TaskAgentReviewInput } from '@tale/shared/schemas/task-review';
import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { reviewAgentTask } from './agent-review.ts';
import { addTaskReviewFeedback } from './comments.ts';
import { readTaskReviewSource } from './review-evidence.ts';
import {
  applyAgentTaskReviewStatusTrusted,
  loadTaskOrThrow,
  type TaskRow,
} from './service.ts';

vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: vi.fn(),
}));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../collab/service.ts', () => ({
  dismissReviewRequestNotifications: vi.fn(),
}));
vi.mock('../projects/service.ts', () => ({
  loadProjectOrThrow: vi.fn().mockResolvedValue({ id: 'project' }),
}));
vi.mock('./comments.ts', () => ({
  queuedOnTask: vi.fn(
    (_tx: unknown, _id: string, work: () => Promise<unknown>) => work(),
  ),
  addTaskReviewFeedback: vi.fn(),
}));
vi.mock('./review-evidence.ts', () => ({ readTaskReviewSource: vi.fn() }));
vi.mock('./service.ts', () => ({
  applyAgentTaskReviewStatusTrusted: vi.fn(),
  assertTaskCreatable: vi.fn(),
  loadTaskOrThrow: vi.fn(),
  recordActivity: vi.fn(),
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

const auth = {
  organizationId: 'org',
  projectId: 'project',
  agentId: 'reviewer',
  sessionId: 'pa-reviewer',
  execId: 'issuer-exec',
};
const input: TaskAgentReviewInput = {
  taskId: 'task',
  expected: {
    approvalId: 'approval',
    runId: 'source',
    evidenceRevision: 'a'.repeat(64),
  },
  decision: 'approve',
  feedback: 'The captured source and local regression pass.',
  evidence: {
    checks: [
      {
        name: 'Regression',
        outcome: 'passed',
        details: 'Exact captured source; twelve tests passed.',
      },
    ],
    pullRequests: [],
  },
};
function fixture(
  options: {
    noIssuer?: boolean;
    noGrant?: boolean;
    noApproval?: boolean;
    wf?: boolean;
    recipient?: string;
    latest?: string;
    extraPending?: boolean;
  } = {},
) {
  const approval = {
    id: 'approval',
    organizationId: 'org',
    status: 'pending',
    wfExecutionId: options.wf ? 'workflow' : null,
    approvedBy: null,
    reviewedAt: null,
    createdAt: 1,
    metadata: {
      projectId: 'project',
      runId: 'source',
      reviewer: { kind: 'agent', agentId: options.recipient ?? 'reviewer' },
    } as Record<string, unknown>,
  };
  const reads: string[] = [];
  const writes: { text: string; values: unknown[] }[] = [];
  const tag = (
    parts: TemplateStringsArray | unknown[],
    ...values: unknown[]
  ) => {
    if (!('raw' in parts)) return parts;
    const text = parts.join('?').replaceAll(/\s+/g, ' ').trim();
    if (text.startsWith('SELECT')) reads.push(text);
    else writes.push({ text, values });
    if (text.includes('FROM app.project_agent_runs r'))
      return Promise.resolve(
        options.noIssuer
          ? []
          : [{ id: 'issuer', tools: options.noGrant ? [] : ['task_review'] }],
      );
    if (text.includes('FROM app.project_agent_runs'))
      return Promise.resolve([{ id: options.latest ?? 'source' }]);
    if (text.includes('FROM app.approvals'))
      return Promise.resolve(
        options.noApproval
          ? []
          : text.includes("status = 'pending'")
            ? [
                { id: 'approval' },
                ...(options.extraPending ? [{ id: 'protected' }] : []),
              ]
            : [approval],
      );
    if (text.startsWith('UPDATE app.approvals')) {
      approval.status = String(values[0]);
      const metadata = values[2];
      if (metadata !== null && typeof metadata === 'object')
        Object.assign(approval.metadata, metadata);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the reached postgres.js calls; real transactions and races are covered in integration
  const tx = Object.assign(tag, {
    json: (value: unknown) => value,
  }) as unknown as TransactionSql;
  return {
    tx,
    approval,
    writes,
    reads,
    call: (data: unknown = input) => reviewAgentTask(tx, auth, data),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadTaskOrThrow).mockResolvedValue(task({ assigneeId: 'author' }));
  vi.mocked(readTaskReviewSource).mockResolvedValue({
    runId: 'source',
    implementationAgentId: 'author',
    status: 'settled',
    settledAt: 1,
    evidenceRevision: 'a'.repeat(64),
  });
  vi.mocked(readGovernancePolicyForOrg).mockResolvedValue(null);
  vi.mocked(applyAgentTaskReviewStatusTrusted).mockResolvedValue(undefined);
  vi.mocked(addTaskReviewFeedback).mockResolvedValue({
    messageId: 'feedback',
    threadId: 'discussion',
    unresolvedMentionTokens: [],
  });
});

describe('independent source-bound task decision', () => {
  it('records its actual reviewer and issuer while preserving the implementation owner', async () => {
    const f = fixture();
    const receipt = await f.call();
    expect(receipt).toMatchObject({
      taskId: 'task',
      approvalId: 'approval',
      runId: 'source',
      reviewer: { kind: 'agent', agentId: 'reviewer' },
      issuerRunId: 'issuer',
      status: 'done',
      feedbackCommentId: 'feedback',
    });
    expect(applyAgentTaskReviewStatusTrusted).toHaveBeenCalledWith(f.tx, {
      task: expect.objectContaining({ assigneeId: 'author' }),
      agentId: 'reviewer',
      status: 'done',
    });
    expect(f.approval.metadata.response).toEqual(receipt);
    expect(f.approval.approvedBy).toBeNull();
  });
  it('returns changes to To do with feedback, without assigning or starting any work', async () => {
    const f = fixture();
    const receipt = await f.call({
      ...input,
      decision: 'request_changes',
      feedback: '@author Reproduce the failing regression first.',
    });
    expect(receipt.status).toBe('todo');
    expect(f.approval.status).toBe('rejected');
    expect(addTaskReviewFeedback).toHaveBeenCalledWith(
      f.tx,
      expect.objectContaining({
        agentId: 'reviewer',
        body: '@author Reproduce the failing regression first.',
      }),
    );
    expect(
      f.writes.every(
        ({ text }) =>
          text.startsWith('UPDATE app.tasks') ||
          text.startsWith('UPDATE app.approvals'),
      ),
    ).toBe(true);
  });
  it('rechecks live authority then returns the identical retry receipt without effects', async () => {
    const f = fixture();
    const first = await f.call();
    const second = await f.call();
    expect(second).toEqual(first);
    expect(
      f.reads.filter((text) => text.includes('JOIN app.project_agents')),
    ).toHaveLength(2);
    expect(applyAgentTaskReviewStatusTrusted).toHaveBeenCalledOnce();
    expect(addTaskReviewFeedback).toHaveBeenCalledOnce();
  });
  it.each([
    (value: TaskAgentReviewInput) => ({
      ...value,
      decision: 'request_changes',
    }),
    (value: TaskAgentReviewInput) => ({
      ...value,
      feedback: 'Different review.',
    }),
    (value: TaskAgentReviewInput) => ({
      ...value,
      evidence: {
        ...value.evidence,
        checks: [
          { name: 'Different', outcome: 'passed', details: 'Another result.' },
        ],
      },
    }),
  ])(
    'does not treat a different verdict, feedback or evidence as replay',
    async (change) => {
      const f = fixture();
      await f.call();
      await expect(f.call(change(input))).rejects.toMatchObject({
        code: 'TASK_REVIEW_STALE',
      });
      expect(addTaskReviewFeedback).toHaveBeenCalledOnce();
    },
  );
  it.each([{ noIssuer: true }, { noGrant: true }])(
    'refuses unavailable authority before even the target lock %j',
    async (options) => {
      const f = fixture(options);
      await expect(f.call()).rejects.toMatchObject({
        code: 'TASK_REVIEW_FORBIDDEN',
      });
      expect(f.writes).toEqual([]);
      expect(loadTaskOrThrow).not.toHaveBeenCalled();
    },
  );
  it('never borrows another project through a caller-named task', async () => {
    vi.mocked(loadTaskOrThrow).mockResolvedValue(task({ projectId: 'other' }));
    const f = fixture();
    await expect(f.call()).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' });
    expect(f.writes).toEqual([]);
  });
  it.each([
    [{ noApproval: true }, 'TASK_REVIEW_STALE'],
    [{ recipient: 'other-reviewer' }, 'TASK_REVIEW_FORBIDDEN'],
    [{ wf: true }, 'TASK_REVIEW_SOURCE_REQUIRED'],
    [{ latest: 'newer-source' }, 'TASK_REVIEW_STALE'],
    [{ extraPending: true }, 'TASK_REVIEW_STALE'],
  ] as const)(
    'preserves incompatible approval/source state %j',
    async (options, code) => {
      const f = fixture(options);
      await expect(f.call()).rejects.toMatchObject({ code });
      expect(applyAgentTaskReviewStatusTrusted).not.toHaveBeenCalled();
      expect(addTaskReviewFeedback).not.toHaveBeenCalled();
      expect(f.approval.status).toBe('pending');
    },
  );
  it.each([
    [null, 'TASK_REVIEW_SOURCE_REQUIRED'],
    [
      {
        runId: 'source',
        implementationAgentId: 'author',
        status: 'running',
        settledAt: null,
        evidenceRevision: 'a'.repeat(64),
      },
      'TASK_REVIEW_SOURCE_REQUIRED',
    ],
    [
      {
        runId: 'source',
        implementationAgentId: 'reviewer',
        status: 'settled',
        settledAt: 1,
        evidenceRevision: 'a'.repeat(64),
      },
      'TASK_REVIEWER_NOT_INDEPENDENT',
    ],
    [
      {
        runId: 'source',
        implementationAgentId: 'author',
        status: 'settled',
        settledAt: 1,
        evidenceRevision: 'b'.repeat(64),
      },
      'TASK_REVIEW_STALE',
    ],
  ] as const)(
    'refuses unresolved, live, self-authored or changed evidence %j',
    async (source, code) => {
      vi.mocked(readTaskReviewSource).mockResolvedValue(source);
      await expect(fixture().call()).rejects.toMatchObject({ code });
      expect(applyAgentTaskReviewStatusTrusted).not.toHaveBeenCalled();
    },
  );
  it('refuses a source whose implementation assignee has changed', async () => {
    vi.mocked(loadTaskOrThrow).mockResolvedValue(
      task({ assigneeId: 'someone-else' }),
    );
    await expect(fixture().call()).rejects.toMatchObject({
      code: 'TASK_REVIEW_STALE',
    });
  });
  it('never borrows the starter competence for an agent decision', async () => {
    vi.mocked(readGovernancePolicyForOrg).mockResolvedValue({
      requiredCompetences: ['release'],
    });
    await expect(fixture().call()).rejects.toMatchObject({
      code: 'TASK_REVIEW_HUMAN_COMPETENCE_REQUIRED',
    });
    expect(applyAgentTaskReviewStatusTrusted).not.toHaveBeenCalled();
  });
  it('fails closed when governance cannot be read', async () => {
    vi.mocked(readGovernancePolicyForOrg).mockRejectedValue(
      new Error('Unavailable'),
    );
    await expect(fixture().call()).rejects.toMatchObject({
      code: 'TASK_REVIEW_POLICY_UNAVAILABLE',
    });
    expect(applyAgentTaskReviewStatusTrusted).not.toHaveBeenCalled();
  });
  it('does not add feedback when shared completion preconditions refuse', async () => {
    vi.mocked(applyAgentTaskReviewStatusTrusted).mockRejectedValue(
      Object.assign(new Error('Live question'), { code: 'TASK_REVIEW_BUSY' }),
    );
    const f = fixture();
    await expect(f.call()).rejects.toMatchObject({ code: 'TASK_REVIEW_BUSY' });
    expect(addTaskReviewFeedback).not.toHaveBeenCalled();
    expect(f.approval.status).toBe('pending');
  });
  it('rejects forged identity fields before authority or target reads', async () => {
    const f = fixture();
    await expect(f.call({ ...input, agentId: 'forged' })).rejects.toMatchObject(
      { code: 'TASK_REVIEW_INVALID' },
    );
    expect(f.reads).toEqual([]);
  });
});
