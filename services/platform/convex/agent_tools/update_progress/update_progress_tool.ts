/**
 * Worker tool: update the spawned job's progress checklist (rendered live on
 * the job card in the parent chat).
 *
 * Deliberately NOT in the tool registry: it is worker plumbing spliced into a
 * job generation by `runGenerationCore` (`WORKER_BASELINE_TOOLS`), never
 * grantable to a primary agent — a primary's plan surface is `update_todos`.
 * Inside a job generation `ctx.threadId` IS the job's transcript thread, which
 * is how the mutation resolves the job row (`by_job_thread`).
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { containsSuspiciousInjection } from '../../lib/untrusted_content';

const progressOperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('add'),
    id: z
      .string()
      .min(1)
      .max(80)
      .describe('Stable short id (e.g. q1, q2). Never reuse a removed id.'),
    content: z.string().min(1).max(500).describe('The checklist item text.'),
  }),
  z.object({
    type: z.literal('update'),
    id: z.string().min(1).max(80),
    content: z.string().min(1).max(500).optional(),
    status: z
      .enum(['pending', 'in_progress', 'done', 'failed', 'cancelled'])
      .optional(),
    note: z
      .string()
      .max(300)
      .optional()
      .describe('One-line outcome note when finishing an item.'),
  }),
  z.object({
    type: z.literal('remove'),
    id: z.string().min(1).max(80),
  }),
]);

export const updateProgressArgs = z.object({
  opId: z
    .string()
    .min(8)
    .max(128)
    .describe(
      'Fresh unique id for this batch (UUID-like). Retries with the same opId are ignored.',
    ),
  operations: z
    .array(progressOperationSchema)
    .min(1)
    .max(16)
    .describe('Atomic batch of checklist operations.'),
});

export function createUpdateProgressTool() {
  return {
    name: 'update_progress' as const,
    tool: createTool({
      description: `Maintain your job's progress checklist — it is shown LIVE to the user on the job card.

- Start non-trivial work with 3-7 pending items (stable ids like q1, q2).
- Keep at most ONE item in_progress at a time.
- Close each item with status done/failed and a one-line note.
- Generate a fresh opId for every call.`,
      inputSchema: updateProgressArgs,
      execute: async (ctx: ToolCtx, args) => {
        const { threadId } = ctx;
        if (!threadId) {
          return {
            success: false,
            error: 'update_progress requires a threadId in the tool context.',
          };
        }
        for (const op of args.operations) {
          if (op.type === 'remove') continue;
          const texts = [
            op.content,
            op.type === 'update' ? op.note : undefined,
          ];
          if (
            texts.some((t) => t !== undefined && containsSuspiciousInjection(t))
          ) {
            return {
              success: false,
              error:
                'Progress content looks like copied untrusted instructions; rephrase it in your own words.',
            };
          }
        }
        return await ctx.runMutation(
          internal.agent_jobs.internal_mutations.applyProgressOperations,
          {
            jobThreadId: threadId,
            opId: args.opId,
            operations: args.operations,
          },
        );
      },
    }),
  };
}
