/**
 * Convex Tool: Workflow Syntax Reference
 *
 * Read-only access to workflow step syntax by category.
 * For the 'action' category, also includes available integrations for the org.
 */

import type { ToolCtx } from '@convex-dev/agent';

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ToolDefinition } from '../types';

import { internal } from '../../_generated/api';
import { formatIntegrationsForContext } from '../sub_agents/helpers/format_integrations';
import { getAllSyntax, getSyntaxReference } from './helpers/syntax_reference';

const workflowSyntaxArgs = z.object({
  category: z
    .enum([
      'start',
      'llm',
      'action',
      'condition',
      'loop',
      'output',
      'workflow_config',
      'variables',
      'hello_world',
    ])
    .optional()
    .describe(
      "Category of syntax to retrieve. Omit to get all categories. Options: 'start', 'llm', 'action', 'condition', 'loop', 'output', 'workflow_config', 'variables'.",
    ),
});

async function fetchIntegrationsContext(ctx: ToolCtx): Promise<string> {
  const { organizationId } = ctx;
  if (!organizationId) {
    return '';
  }

  const integrations = await ctx.runQuery(
    internal.integrations.internal_queries.listInternal,
    { organizationId },
  );

  if (!integrations || integrations.length === 0) {
    return '\n\n### Available Integrations\nNo integrations configured. Set up in Settings > Integrations first.';
  }

  const listing = formatIntegrationsForContext(integrations);
  return `\n\n### Available Integrations\nUse integration_introspect to get operations and parameter details.\n\n${listing}`;
}

export const workflowSyntaxTool: ToolDefinition = {
  name: 'workflow_syntax',
  tool: createTool({
    description: `Access workflow syntax reference. Omit category to get all syntax at once.

**SYNTAX CATEGORIES:**
• 'start': Start step config (workflow entry point with optional inputSchema)
• 'llm': LLM step config (requires name + systemPrompt)
• 'action': Action types + available integrations for this org
• 'condition': JEXL condition expressions
• 'loop': Loop step for iteration
• 'output': Output step config (workflow output via mapping)
• 'workflow_config': Workflow-level config (timeout, retryPolicy, variables)
• 'variables': Variable syntax and JEXL filters
• 'hello_world': Complete hello world example (start → llm → output)`,
    args: workflowSyntaxArgs,
    handler: async (ctx: ToolCtx, args) => {
      if (!args.category) {
        const result = getAllSyntax();
        const integrationsContext = await fetchIntegrationsContext(ctx);
        return {
          ...result,
          syntax: result.syntax + integrationsContext,
        };
      }

      const result = getSyntaxReference({ category: args.category });

      if (args.category === 'action' && result.found) {
        const integrationsContext = await fetchIntegrationsContext(ctx);
        return {
          ...result,
          syntax: result.syntax + integrationsContext,
        };
      }

      return result;
    },
  }),
} as const;
