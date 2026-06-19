/**
 * Convex Tool: Metrics Read
 *
 * Read-only workforce metrics so analyst/manager agents can ground their work
 * in real numbers — how much the team produced, how agents are performing, and
 * what's queued or stuck — and act on it (reassign, escalate, decompose).
 * Wraps the same aggregate the daily-digest workflow uses, under hard scan caps
 * (a `capped: true` flag signals a lower-bound when the org is very large).
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { requireOrganizationId } from '../tasks/helpers/context';
import type { ToolDefinition } from '../types';

const metricsReadArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('workforce_summary'),
    windowHours: z
      .number()
      .optional()
      .describe(
        'Look-back window in hours (default 24, max 168 = 7 days). Use 168 for a weekly view.',
      ),
  }),
]);

export const metricsReadTool: ToolDefinition = {
  name: 'metrics_read',
  tool: createTool({
    description: `Read workforce metrics for the organization to analyze performance and decide what to do next.

OPERATIONS:
• 'workforce_summary': Aggregates over a look-back window — tasks created / completed / cancelled, reviews passed vs changes-requested, agent runs and failures, total agent spend (costCents), pending reviews, queued runs, and open circuit breakers. Returns 'activity' (a single rolled-up figure) and a 'capped' flag (true ⇒ the org is large and the numbers are a lower bound).

Use this to spot bottlenecks (rising pendingReviews/queuedRuns/openBreakers), track throughput and spend, and justify reassigning, escalating, or decomposing work. For per-entity counts (customers, products, vendors) use the matching *_read 'count'/'list' operation.`,
    inputSchema: metricsReadArgs,
    execute: async (ctx: ToolCtx, args) => {
      const organizationId = requireOrganizationId(ctx);

      // operation === 'workforce_summary'
      const summary = await ctx.runQuery(
        internal.task_metrics.internal_queries.getDailySummaryInternal,
        { organizationId, windowHours: args.windowHours },
      );
      const activity =
        summary.tasksCreated +
        summary.tasksCompleted +
        summary.runs +
        summary.pendingReviews +
        summary.queuedRuns +
        summary.openBreakers;
      return { operation: 'workforce_summary', ...summary, activity };
    },
  }),
} as const;
