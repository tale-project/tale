import { z } from 'zod/v4';

const reviewerIdSchema = z.string().min(1).max(200);

/** A task either inherits its project or explicitly chooses one actor. */
export const taskReviewerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inherit') }).strict(),
  z.object({ kind: z.literal('user'), userId: reviewerIdSchema }).strict(),
  z.object({ kind: z.literal('agent'), agentId: reviewerIdSchema }).strict(),
]);
export type TaskReviewer = z.infer<typeof taskReviewerSchema>;

/** Human default preserves the existing eligible creator fallback chain. */
export const projectTaskReviewerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('human_default') }).strict(),
  z.object({ kind: z.literal('agent'), agentId: reviewerIdSchema }).strict(),
]);
export type ProjectTaskReviewer = z.infer<typeof projectTaskReviewerSchema>;

/** Captured on the pending review; never recomputed from a changed default. */
export const taskReviewRecipientSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), userId: reviewerIdSchema }).strict(),
  z.object({ kind: z.literal('agent'), agentId: reviewerIdSchema }).strict(),
]);
export type TaskReviewRecipient = z.infer<typeof taskReviewRecipientSchema>;

export const pendingReviewIdentitySchema = z
  .object({
    approvalId: reviewerIdSchema,
    runId: reviewerIdSchema.nullable(),
    reviewer: taskReviewRecipientSchema.nullable(),
  })
  .strict();
export type PendingReviewIdentity = z.infer<typeof pendingReviewIdentitySchema>;

export const setTaskReviewerInputSchema = z
  .object({
    reviewer: taskReviewerSchema,
    expected: z
      .object({
        reviewer: taskReviewerSchema,
        pendingReview: pendingReviewIdentitySchema.nullable(),
      })
      .strict(),
  })
  .strict();
export type SetTaskReviewerInput = z.infer<typeof setTaskReviewerInputSchema>;

export const setProjectTaskReviewerInputSchema = z
  .object({
    reviewer: projectTaskReviewerSchema,
    expected: projectTaskReviewerSchema,
  })
  .strict();
export type SetProjectTaskReviewerInput = z.infer<
  typeof setProjectTaskReviewerInputSchema
>;

const evidenceRevisionSchema = z.string().regex(/^[a-f0-9]{64}$/);

/** External checks and heads are the reviewer's attestation. The native
 * decision validates its own task/run snapshot, not GitHub's current state. */
export const taskReviewEvidenceSchema = z
  .object({
    checks: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(200),
            outcome: z.enum(['passed', 'failed']),
            details: z.string().trim().min(1).max(2000),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    pullRequests: z
      .array(
        z
          .object({
            url: z
              .string()
              .url()
              .max(2048)
              .regex(
                /^https:\/\/github\.com\/[^/?#]+\/[^/?#]+\/pull\/[1-9]\d*$/,
              ),
            headSha: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
            checks: z.enum(['passed', 'failed', 'pending']),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();
export type TaskReviewEvidence = z.infer<typeof taskReviewEvidenceSchema>;

export const taskAgentReviewInputSchema = z
  .object({
    taskId: reviewerIdSchema,
    expected: z
      .object({
        approvalId: reviewerIdSchema,
        runId: reviewerIdSchema,
        evidenceRevision: evidenceRevisionSchema,
      })
      .strict(),
    decision: z.enum(['approve', 'request_changes']),
    feedback: z.string().trim().min(1).max(8000),
    evidence: taskReviewEvidenceSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.decision === 'approve' &&
      (value.evidence.checks.some((check) => check.outcome !== 'passed') ||
        value.evidence.pullRequests.some((pr) => pr.checks !== 'passed'))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidence'],
        message:
          'Approve only with concrete passed checks for every supplied result.',
      });
    }
  });
export type TaskAgentReviewInput = z.infer<typeof taskAgentReviewInputSchema>;

/** Durable agent decision. `approved_by` remains a human-only database
 * field; agent identity and the exact issuer/source live in this receipt. */
export const taskAgentReviewReceiptSchema = z
  .object({
    taskId: reviewerIdSchema,
    approvalId: reviewerIdSchema,
    runId: reviewerIdSchema,
    reviewer: z
      .object({ kind: z.literal('agent'), agentId: reviewerIdSchema })
      .strict(),
    issuerRunId: reviewerIdSchema,
    evidenceRevision: evidenceRevisionSchema,
    decision: z.enum(['approve', 'request_changes']),
    status: z.enum(['done', 'todo']),
    feedbackCommentId: reviewerIdSchema,
    evidence: taskReviewEvidenceSchema,
    decidedAt: z.number().int().nonnegative(),
  })
  .strict();
export type TaskAgentReviewReceipt = z.infer<
  typeof taskAgentReviewReceiptSchema
>;

/** Accept omitted nullable fields from older read adapters during rollout. */
export function taskReviewerFromIds(row: {
  reviewerUserId?: string | null;
  reviewerAgentId?: string | null;
}): TaskReviewer {
  if (row.reviewerAgentId != null) {
    return { kind: 'agent', agentId: row.reviewerAgentId };
  }
  if (row.reviewerUserId != null) {
    return { kind: 'user', userId: row.reviewerUserId };
  }
  return { kind: 'inherit' };
}

export function projectTaskReviewerFromId(
  agentId: string | null | undefined,
): ProjectTaskReviewer {
  return agentId == null
    ? { kind: 'human_default' }
    : { kind: 'agent', agentId };
}
