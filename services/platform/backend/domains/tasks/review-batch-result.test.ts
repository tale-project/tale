import type {
  TaskAgentReviewInput,
  TaskAgentReviewReceipt,
} from '@tale/shared/schemas/task-review';
import { taskReviewBatchStartSchema } from '@tale/shared/schemas/task-review-batch';
import { describe, expect, it } from 'vitest';

import { reviewBatchResult } from './review-batch-result.ts';

const taskId = '10000000-0000-4000-8000-000000000001';
const contextTaskId = '10000000-0000-4000-8000-000000000002';
const requestId = '10000000-0000-4000-8000-000000000003';
const evidenceRevision = 'a'.repeat(64);

function fixture(decision: 'approve' | 'request_changes' = 'approve') {
  const target = {
    taskId,
    expected: { approvalId: 'approval', runId: 'source', evidenceRevision },
  };
  const request: TaskAgentReviewInput = {
    ...target,
    decision,
    feedback: 'Independent source check completed',
    evidence: {
      checks: [
        {
          name: 'Source',
          outcome: 'passed',
          details: 'Read the complete changed source',
        },
      ],
      pullRequests: [],
    },
  };
  const receipt: TaskAgentReviewReceipt = {
    taskId,
    approvalId: 'approval',
    runId: 'source',
    evidenceRevision,
    reviewer: { kind: 'agent', agentId: 'reviewer' },
    issuerRunId: 'attempt',
    decision,
    status: decision === 'approve' ? 'done' : 'todo',
    feedbackCommentId: 'feedback',
    evidence: request.evidence,
    decidedAt: 100,
  };
  return {
    batchId: 'batch',
    projectId: 'project',
    contextTaskId,
    reviewerAgentId: 'reviewer',
    requestId,
    targets: [target],
    runs: [{ runId: 'attempt', status: 'settled' }],
    approvals: [
      {
        id: 'approval',
        taskId,
        status: decision === 'approve' ? 'completed' : 'rejected',
        metadata: {
          projectId: 'project',
          runId: 'source',
          reviewer: receipt.reviewer,
          response: receipt,
          agentReviewRequest: request,
        },
      },
    ],
  };
}

describe('native fixed review envelope [TASK-R28]', () => {
  it.each(['approve', 'request_changes'] as const)(
    'counts only native %s as a finished review action',
    (decision) => {
      expect(reviewBatchResult(fixture(decision))).toMatchObject({
        outcome: 'complete',
        targets: [{ decision, issuerRunId: 'attempt' }],
      });
    },
  );

  it('does not turn a settled report or subset of decisions into completeness', () => {
    const input = fixture();
    input.targets.push({
      taskId: contextTaskId,
      expected: { approvalId: 'remaining', runId: 'other', evidenceRevision },
    });
    expect(reviewBatchResult(input)).toMatchObject({
      outcome: 'incomplete',
      targets: [{ decision: 'approve' }, { decision: null, issuerRunId: null }],
    });
    expect(reviewBatchResult({ ...input, approvals: [] }).outcome).toBe(
      'incomplete',
    );
  });

  it.each([
    'wrong issuer',
    'wrong reviewer',
    'wrong captured reviewer',
    'wrong source',
    'wrong revision',
    'wrong task',
    'wrong approval',
    'wrong status',
    'wrong receipt status',
    'wrong request',
    'wrong request evidence',
    'missing request',
    'duplicate approval',
    'retained receipt without retained issuer',
  ])('refuses complete for %s', (mutation) => {
    const input = fixture();
    const approval = input.approvals[0]!;
    const receipt = approval.metadata.response;
    switch (mutation) {
      case 'wrong issuer':
        receipt.issuerRunId = 'another-batch';
        break;
      case 'wrong reviewer':
        receipt.reviewer = { kind: 'agent', agentId: 'author' };
        break;
      case 'wrong captured reviewer':
        approval.metadata.reviewer = { kind: 'agent', agentId: 'other' };
        break;
      case 'wrong source':
        receipt.runId = 'new-source';
        break;
      case 'wrong revision':
        receipt.evidenceRevision = 'b'.repeat(64);
        break;
      case 'wrong task':
        receipt.taskId = 'another-task';
        break;
      case 'wrong approval':
        receipt.approvalId = 'another-approval';
        break;
      case 'wrong status':
        approval.status = 'pending';
        break;
      case 'wrong receipt status':
        receipt.status = 'todo';
        break;
      case 'wrong request':
        approval.metadata.agentReviewRequest = {
          ...approval.metadata.agentReviewRequest,
          decision: 'request_changes',
        };
        break;
      case 'wrong request evidence':
        approval.metadata.agentReviewRequest = {
          ...approval.metadata.agentReviewRequest,
          evidence: {
            checks: [
              {
                name: 'different',
                outcome: 'passed',
                details: 'Unrelated evidence',
              },
            ],
            pullRequests: [],
          },
        };
        break;
      case 'missing request':
        Reflect.deleteProperty(approval.metadata, 'agentReviewRequest');
        break;
      case 'duplicate approval':
        input.approvals.push(approval);
        break;
      case 'retained receipt without retained issuer':
        input.runs = [];
        break;
    }
    expect(reviewBatchResult(input).outcome).toBe('incomplete');
  });

  it('accepts actual retry attempts only when native cohort selection includes them', () => {
    const input = fixture();
    input.approvals[0]!.metadata.response.issuerRunId = 'retry';
    expect(reviewBatchResult(input).outcome).toBe('incomplete');
    input.runs.push({ runId: 'retry', status: 'running' });
    expect(reviewBatchResult(input).outcome).toBe('complete');
  });

  it('strictly bounds declarations and refuses unknown/legacy operation fields', () => {
    const input = {
      operation: 'start_batch',
      contextTaskId,
      requestId,
      targets: fixture().targets,
    };
    expect(taskReviewBatchStartSchema.safeParse(input).success).toBe(true);
    for (const invalid of [
      { ...input, targets: [] },
      { ...input, targets: Array(21).fill(input.targets[0]) },
      { ...input, targets: [...input.targets, ...input.targets] },
      { ...input, moveToInProgress: false },
      { ...input, requestId: 'guess' },
      { ...input, operation: 'start' },
    ])
      expect(taskReviewBatchStartSchema.safeParse(invalid).success).toBe(false);
  });
});
