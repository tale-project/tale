import { describe, expect, it } from 'vitest';

import {
  projectTaskReviewerFromId,
  taskAgentReviewInputSchema,
  taskAgentReviewReceiptSchema,
  setProjectTaskReviewerInputSchema,
  setTaskReviewerInputSchema,
  taskReviewerFromIds,
} from './task-review.ts';

describe('explicit task review routing', () => {
  it('keeps omitted and null legacy rows on the human-default inheritance path', () => {
    expect(taskReviewerFromIds({})).toEqual({ kind: 'inherit' });
    expect(
      taskReviewerFromIds({ reviewerUserId: null, reviewerAgentId: null }),
    ).toEqual({ kind: 'inherit' });
    expect(projectTaskReviewerFromId(undefined)).toEqual({
      kind: 'human_default',
    });
    expect(projectTaskReviewerFromId(null)).toEqual({ kind: 'human_default' });
  });

  it('distinguishes explicit actors from the project default', () => {
    expect(taskReviewerFromIds({ reviewerUserId: 'person' })).toEqual({
      kind: 'user',
      userId: 'person',
    });
    expect(taskReviewerFromIds({ reviewerAgentId: 'reviewer' })).toEqual({
      kind: 'agent',
      agentId: 'reviewer',
    });
    expect(projectTaskReviewerFromId('reviewer')).toEqual({
      kind: 'agent',
      agentId: 'reviewer',
    });
  });

  it('requires an exact captured review identity for handoff', () => {
    const body = {
      reviewer: { kind: 'agent', agentId: 'reviewer' },
      expected: {
        reviewer: { kind: 'inherit' },
        pendingReview: {
          approvalId: 'approval',
          runId: 'run',
          reviewer: { kind: 'user', userId: 'person' },
        },
      },
    };
    expect(setTaskReviewerInputSchema.parse(body)).toEqual(body);
    expect(
      setTaskReviewerInputSchema.safeParse({
        ...body,
        expected: { reviewer: { kind: 'inherit' } },
      }).success,
    ).toBe(false);
  });

  it.each([
    { kind: 'agent', agentId: '' },
    { kind: 'user', userId: 'person', agentId: 'reviewer' },
    { kind: 'inherit', userId: null },
    null,
  ])('refuses ambiguous or malformed task routing %j', (reviewer) => {
    expect(
      setTaskReviewerInputSchema.safeParse({
        reviewer,
        expected: { reviewer: { kind: 'inherit' }, pendingReview: null },
      }).success,
    ).toBe(false);
  });

  it('refuses extra execution, status, grant and approval fields', () => {
    const body = {
      reviewer: { kind: 'human_default' },
      expected: { kind: 'agent', agentId: 'reviewer' },
    };
    expect(setProjectTaskReviewerInputSchema.parse(body)).toEqual(body);
    for (const field of ['start', 'status', 'tools', 'approve']) {
      expect(
        setProjectTaskReviewerInputSchema.safeParse({ ...body, [field]: true })
          .success,
      ).toBe(false);
    }
  });
});

describe('source-bound agent decision boundary', () => {
  const valid = {
    taskId: 'target',
    expected: {
      approvalId: 'approval',
      runId: 'source',
      evidenceRevision: 'a'.repeat(64),
    },
    decision: 'approve',
    feedback: 'The local regression and exact PR head pass.',
    evidence: {
      checks: [
        {
          name: 'Local regression',
          outcome: 'passed',
          details: '12 tests passed on the captured source.',
        },
      ],
      pullRequests: [
        {
          url: 'https://github.com/example/project/pull/12',
          headSha: 'b'.repeat(40),
          checks: 'passed',
        },
      ],
    },
  };
  it('accepts complete evidence and the same source-bound receipt', () => {
    expect(taskAgentReviewInputSchema.parse(valid)).toEqual(valid);
    expect(
      taskAgentReviewReceiptSchema.safeParse({
        taskId: valid.taskId,
        approvalId: 'approval',
        runId: 'source',
        reviewer: { kind: 'agent', agentId: 'reviewer' },
        issuerRunId: 'issuer',
        evidenceRevision: 'a'.repeat(64),
        decision: 'approve',
        status: 'done',
        feedbackCommentId: 'feedback',
        evidence: valid.evidence,
        decidedAt: 100,
      }).success,
    ).toBe(true);
  });
  it.each([
    { ...valid, actorId: 'forged' },
    { ...valid, tools: ['task_review'] },
    { ...valid, status: 'done' },
    { ...valid, feedback: '  ' },
    { ...valid, feedback: 'x'.repeat(8001) },
    { ...valid, expected: { ...valid.expected, evidenceRevision: null } },
    { ...valid, expected: { ...valid.expected, runId: null } },
    { ...valid, expected: { ...valid.expected, reviewerAgentId: 'forged' } },
    { ...valid, evidence: { ...valid.evidence, checks: [] } },
    {
      ...valid,
      evidence: {
        ...valid.evidence,
        checks: [{ name: 'result', outcome: 'passed', details: ' ' }],
      },
    },
    {
      ...valid,
      evidence: {
        ...valid.evidence,
        checks: Array.from({ length: 21 }, () => valid.evidence.checks[0]),
      },
    },
    {
      ...valid,
      evidence: {
        ...valid.evidence,
        pullRequests: [
          {
            url: 'https://evil.test/pull/12',
            headSha: 'b'.repeat(40),
            checks: 'passed',
          },
        ],
      },
    },
    {
      ...valid,
      evidence: {
        ...valid.evidence,
        pullRequests: [{ ...valid.evidence.pullRequests[0], headSha: 'abcd' }],
      },
    },
    {
      ...valid,
      evidence: {
        ...valid.evidence,
        pullRequests: [
          { ...valid.evidence.pullRequests[0], checks: 'pending' },
        ],
      },
    },
    {
      ...valid,
      evidence: {
        ...valid.evidence,
        checks: [{ ...valid.evidence.checks[0], outcome: 'failed' }],
      },
    },
  ])(
    'rejects missing, widened or insufficient approval evidence %j',
    (input) => {
      expect(taskAgentReviewInputSchema.safeParse(input).success).toBe(false);
    },
  );
  it('allows a changes verdict to report a failed check and pending PR', () => {
    expect(
      taskAgentReviewInputSchema.safeParse({
        ...valid,
        decision: 'request_changes',
        evidence: {
          checks: [
            {
              name: 'Keyboard',
              outcome: 'failed',
              details: 'Tab cannot reach the confirmation.',
            },
          ],
          pullRequests: [
            { ...valid.evidence.pullRequests[0], checks: 'pending' },
          ],
        },
      }).success,
    ).toBe(true);
  });
});
