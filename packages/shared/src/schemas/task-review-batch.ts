import { z } from 'zod/v4';

import { taskReviewExpectedSchema } from './task-review';

/** A review occurrence declares its whole bounded envelope before it starts.
 * The native decision remains the only authority for each target's outcome. */
export const taskReviewBatchTargetSchema = z.strictObject({
  taskId: z.uuid(),
  expected: taskReviewExpectedSchema,
});
export type TaskReviewBatchTarget = z.infer<typeof taskReviewBatchTargetSchema>;

export const taskReviewBatchTargetsSchema = z
  .array(taskReviewBatchTargetSchema)
  .min(1)
  .max(20)
  .refine(
    (targets) =>
      new Set(targets.map((target) => target.taskId)).size === targets.length,
    'Declare each task once',
  );

export const taskReviewBatchStartSchema = z.strictObject({
  operation: z.literal('start_batch'),
  requestId: z.uuid(),
  contextTaskId: z.uuid(),
  targets: taskReviewBatchTargetsSchema,
});
export type TaskReviewBatchStart = z.infer<typeof taskReviewBatchStartSchema>;

export const taskReviewBatchReadSchema = z.strictObject({
  operation: z.literal('read_batch'),
  batchId: z.uuid(),
});

export interface TaskReviewBatchResult {
  batchId: string;
  contextTaskId: string;
  reviewerAgentId: string;
  requestId: string;
  /** Complete means all review actions are attested, not all work approved. */
  outcome: 'complete' | 'incomplete';
  runs: { runId: string; status: string }[];
  targets: (TaskReviewBatchTarget & {
    decision: 'approve' | 'request_changes' | null;
    issuerRunId: string | null;
  })[];
}
