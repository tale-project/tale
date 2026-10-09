import {
  taskAgentReviewInputSchema,
  taskAgentReviewReceiptSchema,
  taskReviewRecipientSchema,
} from '@tale/shared/schemas/task-review';
import type {
  TaskReviewBatchResult,
  TaskReviewBatchTarget,
} from '@tale/shared/schemas/task-review-batch';

import { stableStringify } from '../../../lib/shared/utils/stable-stringify.ts';

export interface ReviewBatchDecisionRow {
  id: string;
  taskId: string;
  status: string;
  metadata: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

/** Pure projection of native rows; absence or malformed retained evidence is
 * incomplete. A report, output file, settled run or another batch's receipt
 * cannot substitute for even one declared native decision. */
export function reviewBatchResult(args: {
  batchId: string;
  projectId: string;
  contextTaskId: string;
  reviewerAgentId: string;
  requestId: string;
  targets: readonly TaskReviewBatchTarget[];
  runs: { runId: string; status: string }[];
  approvals: readonly ReviewBatchDecisionRow[];
}): TaskReviewBatchResult {
  const issuerIds = new Set(args.runs.map((run) => run.runId));
  const targets = args.targets.map((target) => {
    const matches = args.approvals.filter(
      (row) =>
        row.id === target.expected.approvalId && row.taskId === target.taskId,
    );
    const approval = matches.length === 1 ? matches[0] : undefined;
    const metadata = approval?.metadata;
    const fields = isRecord(metadata) ? metadata : {};
    const receipt = taskAgentReviewReceiptSchema.safeParse(fields.response);
    const request = taskAgentReviewInputSchema.safeParse(
      fields.agentReviewRequest,
    );
    const recipient = taskReviewRecipientSchema.safeParse(fields.reviewer);
    if (
      receipt.success &&
      request.success &&
      recipient.success &&
      recipient.data.kind === 'agent' &&
      recipient.data.agentId === args.reviewerAgentId &&
      receipt.data.taskId === target.taskId &&
      receipt.data.approvalId === target.expected.approvalId &&
      receipt.data.runId === target.expected.runId &&
      receipt.data.evidenceRevision === target.expected.evidenceRevision &&
      receipt.data.reviewer.agentId === args.reviewerAgentId &&
      issuerIds.has(receipt.data.issuerRunId) &&
      fields.runId === target.expected.runId &&
      fields.projectId === args.projectId &&
      approval?.status ===
        (receipt.data.decision === 'approve' ? 'completed' : 'rejected') &&
      receipt.data.status ===
        (receipt.data.decision === 'approve' ? 'done' : 'todo') &&
      request.data.taskId === target.taskId &&
      stableStringify(request.data.expected) ===
        stableStringify(target.expected) &&
      request.data.decision === receipt.data.decision &&
      stableStringify(request.data.evidence) ===
        stableStringify(receipt.data.evidence)
    ) {
      return {
        ...target,
        decision: receipt.data.decision,
        issuerRunId: receipt.data.issuerRunId,
      };
    }
    return { ...target, decision: null, issuerRunId: null };
  });
  return {
    batchId: args.batchId,
    contextTaskId: args.contextTaskId,
    reviewerAgentId: args.reviewerAgentId,
    requestId: args.requestId,
    outcome:
      targets.length > 0 && targets.every((target) => target.decision !== null)
        ? 'complete'
        : 'incomplete',
    runs: args.runs,
    targets,
  };
}
