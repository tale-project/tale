import { randomUUID } from 'node:crypto';

import { taskDelegateReviewInputSchema } from '@tale/shared/schemas/task-review';
import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  nativeReviewDelegation,
  readTaskReviewDelegation,
} from './review-delegation-receipt.ts';

function fixture() {
  const request = {
    taskId: randomUUID(),
    reviewerAgentId: randomUUID(),
    expected: {
      approvalId: randomUUID(),
      runId: randomUUID(),
      evidenceRevision: 'a'.repeat(64),
      reviewer: { kind: 'agent' as const, agentId: randomUUID() },
    },
    reason: 'Rebalance the captured review to a qualified available agent.',
  };
  const receipt = {
    taskId: request.taskId,
    previousApprovalId: request.expected.approvalId,
    approvalId: randomUUID(),
    runId: request.expected.runId,
    evidenceRevision: request.expected.evidenceRevision,
    previousReviewer: request.expected.reviewer,
    reviewer: { kind: 'agent' as const, agentId: request.reviewerAgentId },
    managerAgentId: randomUUID(),
    issuerRunId: randomUUID(),
    reason: request.reason,
    delegatedAt: 100,
  };
  const previous = {
    id: receipt.previousApprovalId,
    status: 'rejected' as const,
    wfExecutionId: null as string | null,
    metadata: {
      projectId: 'project',
      runId: receipt.runId,
      reviewer: receipt.previousReviewer,
      supersededBy: receipt.approvalId,
      delegation: receipt,
      delegationRequest: request,
    } as Record<string, unknown>,
  };
  const latest = {
    id: receipt.approvalId,
    status: 'pending',
    wfExecutionId: null as string | null,
    metadata: {
      projectId: 'project',
      runId: receipt.runId,
      reviewer: receipt.reviewer,
    } as Record<string, unknown>,
  };
  const task = { id: receipt.taskId, projectId: 'project' };
  const rows = [latest, previous];
  const reads: unknown[] = [];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- read-only SQL fake captures scoping and supplies bounded rows
  const sql = ((parts: TemplateStringsArray, ...values: unknown[]) => {
    reads.push({ text: parts.join('?'), values });
    return Promise.resolve(rows);
  }) as unknown as Sql;
  return {
    request,
    receipt,
    previous,
    latest,
    task,
    rows,
    reads,
    read: () =>
      readTaskReviewDelegation(sql, {
        organizationId: 'org',
        projectId: task.projectId,
        taskId: task.id,
      }),
  };
}

describe('TASK-R22 captured review delegation boundary and history', () => {
  it('accepts only complete native IDs and the captured agent gate', () => {
    const { request } = fixture();
    expect(taskDelegateReviewInputSchema.parse(request)).toEqual(request);
    for (const input of [
      { ...request, taskId: request.taskId.slice(0, 8) },
      { ...request, reason: ' ' },
      { ...request, reason: 'a'.repeat(2001) },
      {
        ...request,
        expected: { ...request.expected, evidenceRevision: 'abcd' },
      },
      {
        ...request,
        expected: {
          ...request.expected,
          reviewer: { kind: 'user', userId: randomUUID() },
        },
      },
      ...[
        'start',
        'status',
        'tools',
        'secrets',
        'projectId',
        'decision',
        'reviewer',
        'actorId',
      ].map((key) => Object.assign({}, request, { [key]: true })),
    ]) {
      expect(taskDelegateReviewInputSchema.safeParse(input).success).toBe(
        false,
      );
    }
  });
  it('reads only the latest gate and predecessor with organization/project/task scope', async () => {
    const f = fixture();
    expect(await f.read()).toEqual(f.receipt);
    expect(f.reads).toEqual([
      {
        text: expect.stringContaining('ORDER BY a.seq DESC LIMIT 2'),
        values: ['org', f.task.id, f.task.projectId],
      },
    ]);
  });
  it.each([
    'approval',
    'task',
    'source',
    'revision',
    'recipient',
    'reason',
    'manager',
    'unknown',
  ] as const)('hides inconsistent %s metadata', (change) => {
    const f = fixture();
    const receipt = { ...f.receipt };
    if (change === 'approval') receipt.approvalId = randomUUID();
    if (change === 'task') receipt.taskId = randomUUID();
    if (change === 'source') receipt.runId = randomUUID();
    if (change === 'revision') receipt.evidenceRevision = 'b'.repeat(64);
    if (change === 'recipient')
      receipt.reviewer = { kind: 'agent', agentId: randomUUID() };
    if (change === 'reason') receipt.reason = 'different';
    if (change === 'manager') receipt.managerAgentId = receipt.reviewer.agentId;
    f.previous.metadata.delegation =
      change === 'unknown' ? { ...receipt, start: true } : receipt;
    expect(nativeReviewDelegation(f.previous, f.task)).toBeNull();
  });
  it.each([
    'newer-gate',
    'workflow',
    'human',
    'source',
    'project',
    'missing',
    'malformed',
  ] as const)('never reaches behind %s', async (change) => {
    const f = fixture();
    if (change === 'newer-gate') f.latest.id = randomUUID();
    if (change === 'workflow') f.latest.wfExecutionId = randomUUID();
    if (change === 'human')
      f.latest.metadata.reviewer = { kind: 'user', userId: 'person' };
    if (change === 'source') f.latest.metadata.runId = randomUUID();
    if (change === 'project') f.latest.metadata.projectId = 'other';
    if (change === 'missing') f.rows.pop();
    if (change === 'malformed') f.previous.metadata.delegationRequest = null;
    expect(await f.read()).toBeNull();
  });
  it('a decided successor keeps a historical receipt, never a claim of current pending work', async () => {
    const f = fixture();
    f.latest.status = 'completed';
    expect(await f.read()).toEqual(f.receipt);
    expect(f.receipt).not.toHaveProperty('status');
  });
});
