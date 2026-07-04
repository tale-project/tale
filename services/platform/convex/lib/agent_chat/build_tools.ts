'use node';

import { snakeCase } from 'lodash';

import { isRecord, narrowStringUnion } from '../../../lib/utils/type-utils';
import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { createEscalationTool } from '../../agent_tools/escalation/create_escalation_tool';
import { createBoundIntegrationTool } from '../../agent_tools/integrations/create_bound_integration_tool';
import { fetchOperationsWithSchema } from '../../agent_tools/integrations/fetch_operations_summary';
import { createBoundMcpTool } from '../../agent_tools/mcp/create_bound_mcp_tool';
import { TOOL_NAMES } from '../../agent_tools/tool_names';
import { getToolRegistryMap } from '../../agent_tools/tool_registry';
import { createBoundWorkflowTool } from '../../agent_tools/workflows/create_bound_workflow_tool';
import { extractInputSchema } from '../../agent_tools/workflows/helpers/extract_input_schema';
import {
  buildChartFromRoster,
  readWorkforceRoster,
} from '../../agents/workforce_ops';
import { renderPrompt } from '../../lib/prompts/registry';
import { createDebugLog } from '../debug_log';

const debugLog = createDebugLog('DEBUG_CHAT_AGENT', '[runAgentGeneration]');

// ---------------------------------------------------------------------------
// T2 helper functions: parallelized tool building
// ---------------------------------------------------------------------------

interface AgentConfigForTools {
  name?: string;
  integrationBindings?: string[];
  delegationDisabled?: boolean;
  workflowBindings?: string[];
}

/**
 * Build bound integration tools for all configured integration bindings.
 */
export async function buildIntegrationTools(
  ctx: ActionCtx,
  agentConfig: AgentConfigForTools,
  organizationId: string,
): Promise<Record<string, unknown> | undefined> {
  if (!agentConfig.integrationBindings?.length) return undefined;

  const results = await Promise.all(
    agentConfig.integrationBindings.map(async (name) => {
      const fetched = await fetchOperationsWithSchema(
        ctx,
        organizationId,
        name,
      );
      return {
        key: `integration_${name}`,
        tool: createBoundIntegrationTool(
          name,
          fetched?.summary,
          fetched?.operations,
          fetched?.metadata,
        ),
      };
    }),
  );

  const tools: Record<string, unknown> = {};
  for (const { key, tool } of results) {
    tools[key] = tool;
  }
  return tools;
}

/**
 * Build the agent's org-chart `escalate` tool (chart members only: a manager
 * above them and/or reports below them). The `delegate_*` tools that used to
 * be built alongside were replaced by `spawn_agent` (agent-on-demand jobs) —
 * a stale `delegates` list in an agent config still forms chart edges here
 * but no longer yields delegation tools. `delegationDisabled` (set on
 * spawned job runs) turns this off entirely.
 *
 * `orgSlug` and `orgLocale` are resolved once by the caller (hoisted into
 * the outer Promise.all) so they can be shared with sibling builders. The
 * chart read shares the 60s agent-list cache, so warm turns stay off the
 * disk.
 */
export async function buildEscalationTools(
  agentConfig: AgentConfigForTools,
  organizationId: string,
  orgSlug: string,
  orgLocale: string,
): Promise<
  | {
      tools: Record<string, unknown>;
      instructionsAppend: string;
    }
  | undefined
> {
  if (agentConfig.delegationDisabled) return undefined;

  const agentSlug = agentConfig.name;
  if (!agentSlug) return undefined;

  let directReports: string[] = [];
  let managerSlug: string | undefined;
  let chartHasEdges = false;
  try {
    const roster = await readWorkforceRoster(orgSlug);
    const chart = buildChartFromRoster(roster);
    chartHasEdges = chart.parents.size > 0;
    directReports = chart.reports.get(agentSlug) ?? [];
    managerSlug = chart.parents.get(agentSlug);
  } catch (error) {
    console.warn(
      '[Workforce] org-chart read failed; escalation unavailable this turn',
      error,
    );
  }

  // Chart membership: has a manager, or has reports. Roots with reports
  // escalate to humans; agents outside the chart get no escalate tool.
  const isChartMember =
    chartHasEdges && (managerSlug !== undefined || directReports.length > 0);
  if (!isChartMember) return undefined;

  const escalationTool = createEscalationTool({
    agentSlug,
    managerSlug,
    organizationId,
  });

  return {
    tools: { [escalationTool.name]: escalationTool.tool },
    instructionsAppend:
      '\n\n' +
      (managerSlug
        ? renderPrompt(
            'escalation.section',
            { manager: managerSlug },
            { locale: orgLocale },
          )
        : renderPrompt('escalation.sectionRoot', {}, { locale: orgLocale })),
  };
}

/**
 * Build bound workflow tools for all configured workflow bindings.
 */
export async function buildWorkflowTools(
  ctx: ActionCtx,
  agentConfig: AgentConfigForTools,
  orgSlug: string,
): Promise<Record<string, unknown> | undefined> {
  if (!agentConfig.workflowBindings?.length) return undefined;

  const results = await Promise.all(
    agentConfig.workflowBindings.map(async (slug) => {
      const result: unknown = await ctx.runAction(
        internal.workflows.file_actions.readWorkflowForExecution,
        { orgSlug, workflowSlug: slug },
      );

      if (!isRecord(result) || result.ok !== true) {
        return null;
      }

      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- readWorkflowForExecution returns v.any() but ok=true guarantees WorkflowJsonConfig shape
      const config = result.config as {
        name: string;
        description?: string;
        steps: Array<{ stepType: string; config?: unknown }>;
      };

      const startStep = config.steps.find((s) => s.stepType === 'start');
      const inputSchema = extractInputSchema(startStep?.config);

      const toolKey = `workflow_${snakeCase(slug)}`;
      return {
        key: toolKey,
        tool: createBoundWorkflowTool(
          {
            workflowSlug: slug,
            name: config.name,
            description: config.description,
          },
          inputSchema,
        ),
      };
    }),
  );

  const tools: Record<string, unknown> = {};
  for (const entry of results) {
    if (entry) {
      tools[entry.key] = entry.tool;
    }
  }

  return Object.keys(tools).length > 0 ? tools : undefined;
}

/**
 * Build bound MCP server tools from all active MCP servers for the org.
 */
export async function buildMcpTools(
  ctx: ActionCtx,
  organizationId: string,
): Promise<Record<string, unknown> | undefined> {
  interface ActiveMcpServer {
    _id: string;
    name: string;
    displayName: string;
    discoveredTools?: Array<{
      name: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
      requiresApproval?: boolean;
    }>;
  }

  const activeServers: ActiveMcpServer[] = await ctx.runQuery(
    internal.mcp_servers.internal_queries.listActiveByOrg,
    { organizationId },
  );

  if (activeServers.length === 0) return undefined;

  const tools: Record<string, unknown> = {};
  for (const server of activeServers) {
    if (!server.discoveredTools?.length) continue;
    for (const tool of server.discoveredTools) {
      const toolKey = `mcp_${server.name}_${tool.name}`;
      tools[toolKey] = createBoundMcpTool(server._id, server.displayName, tool);
    }
  }

  if (Object.keys(tools).length > 0) {
    debugLog('Built bound MCP tools', { names: Object.keys(tools) });
    return tools;
  }
  return undefined;
}

/**
 * Extract a tool description from a createTool() result.
 */
function getToolDescription(tool: unknown): string | undefined {
  if (isRecord(tool) && typeof tool['description'] === 'string') {
    return tool['description'];
  }
  return undefined;
}

/**
 * Build a formatted summary of all tools available to the agent.
 * Used for context window display only — not sent to the LLM.
 */
export function buildToolsSummary(
  convexToolNames: string[] | undefined,
  integrationExtraTools: Record<string, unknown> | undefined,
): string | undefined {
  const entries: string[] = [];

  // Registry tools
  if (convexToolNames?.length) {
    const registry = getToolRegistryMap();
    for (const name of convexToolNames) {
      const validName = narrowStringUnion(name, TOOL_NAMES);
      const toolDef = validName ? registry[validName] : undefined;
      if (toolDef) {
        const description = getToolDescription(toolDef.tool);
        entries.push(
          description ? `### ${name}\n${description}` : `### ${name}`,
        );
      } else {
        entries.push(`### ${name}`);
      }
    }
  }

  // Integration-bound tools
  if (integrationExtraTools) {
    for (const [name, tool] of Object.entries(integrationExtraTools)) {
      const description = getToolDescription(tool);
      entries.push(description ? `### ${name}\n${description}` : `### ${name}`);
    }
  }

  if (entries.length === 0) {
    return undefined;
  }

  return entries.join('\n\n');
}
