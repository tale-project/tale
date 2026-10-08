/**
 * The MCP tools the platform answers from its own records rather than the
 * automation engine's method table: what the app's own screens read, for the
 * caller, under the app's own rules. Each answers like an engine tool — a
 * result, or a refusal as data (`{error, code, hint}`).
 */

import type { Sql } from 'postgres';

import { getOrgAutomationMetrics } from '../automations/metrics.ts';
import type { McpCaller } from './caller.ts';

/** The run figures the automations metrics page shows — every member reads
 * them in the app, so every member's agent does. */
async function automationMetrics(
  sql: Sql,
  caller: McpCaller,
  params: Record<string, unknown>,
): Promise<unknown> {
  const periodDays =
    params.periodDays === 30 ? 30 : params.periodDays === 90 ? 90 : 7;
  const mode = params.mode === 'mock' ? 'mock' : 'live';
  return {
    periodDays,
    mode,
    ...(await getOrgAutomationMetrics(sql, caller.organizationId, {
      periodDays,
      mode,
    })),
  };
}

/** One platform tool, acting as the caller in the caller's organization. */
export async function dispatchPlatformTool(
  sql: Sql,
  caller: McpCaller,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  switch (method) {
    case 'get_automation_metrics':
      return automationMetrics(sql, caller, params);
    default:
      return {
        error: `unknown platform tool "${method}"`,
        code: 'UNKNOWN_METHOD',
        hint: 'tools/list shows the tools this endpoint serves',
      };
  }
}
