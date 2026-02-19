/**
 * Budget check for sub-agent tool handlers.
 *
 * Reads the actionDeadlineMs variable set by generateAgentResponse
 * and determines whether there is enough time remaining to start
 * a new sub-agent operation.
 */

import type { ToolCtx } from '@convex-dev/agent';

import { errorResponse, type ToolResponse } from './tool_response';

const MIN_TOOL_BUDGET_MS = 60_000;
const SUB_AGENT_BUFFER_MS = 30_000;

type BudgetResult =
  | { ok: true; deadlineMs: number | undefined }
  | { ok: false; error: ToolResponse };

export function checkBudget(ctx: ToolCtx): BudgetResult {
  const raw = ctx.variables?.actionDeadlineMs;
  const deadline =
    typeof raw === 'string'
      ? Number(raw)
      : typeof raw === 'number'
        ? raw
        : undefined;
  if (!deadline || !Number.isFinite(deadline)) {
    return { ok: true, deadlineMs: undefined };
  }

  const remainingMs = deadline - Date.now();
  const effectiveRemainingMs = remainingMs - SUB_AGENT_BUFFER_MS;
  if (effectiveRemainingMs < MIN_TOOL_BUDGET_MS) {
    return {
      ok: false,
      error: errorResponse(
        `Time budget exhausted (${Math.round(remainingMs / 1000)}s remaining). Cannot start new sub-agent operation.`,
      ),
    };
  }

  return { ok: true, deadlineMs: deadline - SUB_AGENT_BUFFER_MS };
}
