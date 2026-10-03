import type { TaskAgentReviewReceipt } from '@tale/shared/schemas/task-review';
import { describe, expect, it } from 'vitest';

import {
  nativeReviewDecision,
  type ReviewDecisionRow,
} from './review-decision.ts';
import { repairFeedback } from './review-repair.ts';

const task = { id: 'task', projectId: 'project' };
const receipt: TaskAgentReviewReceipt = {
  taskId: 'task',
  approvalId: 'approval',
  runId: 'source',
  reviewer: { kind: 'agent', agentId: 'reviewer' },
  issuerRunId: 'review-run',
  evidenceRevision: 'a'.repeat(64),
  decision: 'request_changes',
  status: 'todo',
  feedbackCommentId: 'comment',
  decidedAt: 123,
  evidence: {
    checks: [
      {
        name: 'Acceptance',
        outcome: 'failed',
        details: 'Still fails the counterexample',
      },
    ],
    pullRequests: [],
  },
};
function row(): ReviewDecisionRow {
  return {
    id: 'approval',
    status: 'rejected',
    wfExecutionId: null,
    metadata: {
      projectId: 'project',
      runId: 'source',
      reviewer: receipt.reviewer,
      response: structuredClone(receipt),
      agentReviewRequest: {
        taskId: 'task',
        expected: {
          approvalId: 'approval',
          runId: 'source',
          evidenceRevision: receipt.evidenceRevision,
        },
        decision: 'request_changes',
        feedback: 'Fix the observed counterexample',
        evidence: receipt.evidence,
      },
    },
  };
}

describe('native decision readback', () => {
  it('reads recorded evidence without claiming current task state', () => {
    expect(nativeReviewDecision(row(), task)).toEqual(receipt);
  });
  it.each(['pending', 'completed'])(
    'does not expose the request_changes receipt under %s',
    (status) => {
      expect(nativeReviewDecision({ ...row(), status }, task)).toBeNull();
    },
  );
  it('does not reinterpret a human or workflow decision as agent authority', () => {
    const r = row();
    expect(
      nativeReviewDecision({ ...r, wfExecutionId: 'workflow' }, task),
    ).toBeNull();
    expect(
      nativeReviewDecision(
        {
          ...r,
          metadata: {
            ...r.metadata,
            response: {
              decision: 'approve',
              respondedBy: 'human',
              timestamp: 123,
            },
          },
        },
        task,
      ),
    ).toBeNull();
  });
  it.each([
    'taskId',
    'approvalId',
    'runId',
    'evidenceRevision',
    'decision',
    'status',
  ])('refuses corrupted receipt %s', (field) => {
    const r = row();
    expect(
      nativeReviewDecision(
        {
          ...r,
          metadata: {
            ...r.metadata,
            response: { ...receipt, [field]: 'unrelated' },
          },
        },
        task,
      ),
    ).toBeNull();
  });
  it('binds recorded recipient, project and original request as well as the receipt shape', () => {
    const r = row();
    for (const changed of [
      { projectId: 'foreign' },
      { reviewer: { kind: 'agent', agentId: 'other' } },
      { agentReviewRequest: null },
    ]) {
      expect(
        nativeReviewDecision(
          { ...r, metadata: { ...r.metadata, ...changed } },
          task,
        ),
      ).toBeNull();
    }
    expect(nativeReviewDecision(r, { ...task, id: 'other' })).toBeNull();
  });
  it('keeps reviewer feedback whole and derives the reconciliation marker from the decision', () => {
    expect(
      repairFeedback(
        { decision: receipt, feedback: 'Required repair', dispatch: null },
        'Bounded follow-up',
      ),
    ).toBe(
      'repair R=source P=approval F=comment\n\nRequired repair\n\nBounded follow-up',
    );
    expect(() =>
      repairFeedback(
        { decision: receipt, feedback: 'x'.repeat(8000), dispatch: null },
        'y'.repeat(2000),
      ),
    ).toThrow(/The comment is capped at/);
  });
});
