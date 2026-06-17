'use node';

import { snakeCase } from 'lodash';

import { isRecord, narrowStringUnion } from '../../../lib/utils/type-utils';
import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import {
  createDelegationTool,
  buildDelegationInstructionsSection,
} from '../../agent_tools/delegation/create_delegation_tool';
import { loadDelegateAgents } from '../../agent_tools/delegation/load_delegation_agents';
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
 * Build the agent's WORKFORCE tools: delegation + escalation, both derived
 * from the org chart.
 *
 * Effective delegates = the agent's org-chart DIRECT REPORTS — the
 * organigram is the single source of delegation; there is no per-agent
 * delegate list. Chart members (a manager above them and/or
 * reports below them) additionally get the `escalate` tool and a
 * chain-of-command instructions section; `delegationDisabled` (the
 * orchestrator's double-delegation strip) turns ALL of it off.
 *
 * `orgSlug` and `orgLocale` are resolved once by the caller (hoisted into
 * the outer Promise.all) so they can be shared with sibling builders —
 * notably workflows, which also need the real orgSlug for multi-tenant
 * filesystem lookups. Delegate systemInstructions and the appended scaffold
 * text both resolve against `orgLocale` so parent + delegates speak the
 * same language. The chart read shares the 60s agent-list cache, so warm
 * turns stay off the disk.
 */
export async function buildDelegationTools(
  ctx: ActionCtx,
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
  let directReports: string[] = [];
  let managerSlug: string | undefined;
  let chartHasEdges = false;
  try {
    if (agentSlug) {
      const roster = await readWorkforceRoster(orgSlug);
      const chart = buildChartFromRoster(roster);
      chartHasEdges = chart.parents.size > 0;
      directReports = chart.reports.get(agentSlug) ?? [];
      managerSlug = chart.parents.get(agentSlug);
    }
  } catch (error) {
    console.warn(
      '[Workforce] org-chart read failed; delegation unavailable this turn',
      error,
    );
  }

  const effectiveSlugs = directReports.filter((slug) => slug !== agentSlug);

  // Chart membership: has a manager, or has reports. Roots with reports
  // escalate to humans; agents outside the chart get no escalate tool.
  const isChartMember =
    chartHasEdges && (managerSlug !== undefined || directReports.length > 0);

  if (effectiveSlugs.length === 0 && !isChartMember) return undefined;

  const tools: Record<string, unknown> = {};
  const instructionParts: string[] = [];

  if (effectiveSlugs.length > 0) {
    const delegates = await loadDelegateAgents(
      ctx,
      effectiveSlugs,
      organizationId,
      orgSlug,
      orgLocale,
    );
    for (const delegate of delegates) {
      const delegationTool = createDelegationTool(delegate);
      tools[delegationTool.name] = delegationTool.tool;
    }
    if (delegates.length > 0) {
      instructionParts.push(
        buildDelegationInstructionsSection(delegates, orgLocale),
      );
    }
  }

  if (isChartMember && agentSlug) {
    // Pre-load the manager's config here in the Node context (file I/O lives in
    // `'use node'` modules) and pass it in, mirroring how the delegation tools
    // above receive their pre-loaded delegates. This keeps the escalation tool
    // builder in Convex's V8 runtime.
    const [manager] = managerSlug
      ? await loadDelegateAgents(
          ctx,
          [managerSlug],
          organizationId,
          orgSlug,
          orgLocale,
        )
      : [];
    const escalationTool = createEscalationTool({
      agentSlug,
      managerSlug,
      manager,
      organizationId,
    });
    tools[escalationTool.name] = escalationTool.tool;
    instructionParts.push(
      '\n\n' +
        (managerSlug
          ? renderPrompt(
              'escalation.section',
              { manager: managerSlug },
              { locale: orgLocale },
            )
          : renderPrompt('escalation.sectionRoot', {}, { locale: orgLocale })),
    );
  }

  if (Object.keys(tools).length === 0) return undefined;

  return {
    tools,
    instructionsAppend: instructionParts.join(''),
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
