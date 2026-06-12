/**
 * Metrics workflow action — read-only workforce aggregates for automations.
 * Currently one operation:
 *
 *  - `get_daily_summary`: the day's workforce numbers (tasks created /
 *    completed, review outcomes, agent runs + failures + spend, pending
 *    reviews, queued runs, open circuit breakers) from live domain tables
 *    under hard scan caps. Drives the daily-digest workflow — the digest
 *    text itself is deterministic ICU rendering, zero LLM tokens.
 */

import { v } from 'convex/values';

import { internal } from '../../../_generated/api';
import type { ActionDefinition } from '../../helpers/nodes/action/types';

type MetricsActionParams = {
  operation: 'get_daily_summary';
  /** Number, or a template-substituted string ("168") from schedule variables. */
  windowHours?: number | string;
};

export const metricsAction: ActionDefinition<MetricsActionParams> = {
  type: 'metrics',
  title: 'Metrics Operation',
  description:
    "Read-only workforce metrics for automations (get_daily_summary: the window's task/run/review/guardrail counts with a `capped` lower-bound flag). organizationId is read from workflow context variables.",
  parametersValidator: v.object({
    operation: v.literal('get_daily_summary'),
    windowHours: v.optional(v.union(v.number(), v.string())),
  }),
  async execute(ctx, params, variables) {
    const organizationId = variables.organizationId;
    if (typeof organizationId !== 'string' || !organizationId) {
      throw new Error(
        'metrics action requires a string organizationId in workflow context',
      );
    }

    switch (params.operation) {
      case 'get_daily_summary': {
        // Schedule-variable substitution yields strings — coerce defensively.
        const windowHours =
          typeof params.windowHours === 'string'
            ? Number.parseInt(params.windowHours, 10) || undefined
            : params.windowHours;
        const summary = await ctx.runQuery(
          internal.task_metrics.internal_queries.getDailySummaryInternal,
          { organizationId, windowHours },
        );
        // `activity` rolls the headline numbers into one figure so the digest
        // workflow's "anything to report?" condition stays a single JEXL
        // comparison.
        const activity =
          summary.tasksCreated +
          summary.tasksCompleted +
          summary.runs +
          summary.pendingReviews +
          summary.queuedRuns +
          summary.openBreakers;
        return { operation: 'get_daily_summary', ...summary, activity };
      }

      default:
        throw new Error(
          `Unsupported metrics operation: ${(params as { operation: string }).operation}`,
        );
    }
  },
};
