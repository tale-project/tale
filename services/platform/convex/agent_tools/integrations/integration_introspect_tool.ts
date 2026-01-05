/**
 * Convex Tool: Integration Introspect
 *
 * Tool for discovering available integrations and their operations.
 * Helps the agent understand what integrations are configured and what operations they support.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';
import { internal } from '../../_generated/api';
import type { Doc } from '../../_generated/dataModel';
import type { IntegrationIntrospectionResult } from './types';
import { getPredefinedIntegration } from '../../predefined_integrations';
import { getIntrospectionOperations } from '../../workflow/actions/integration/helpers/get_introspection_operations';

const integrationIntrospectArgs = z.object({
  integrationName: z
    .string()
    .describe(
      'The integration name to introspect. Available integration names are provided in the system context.',
    ),
});

export const integrationIntrospectTool: ToolDefinition = {
  name: 'integration_introspect',
  tool: createTool({
    description: `Get available operations for a specific integration.

Use this tool to discover what operations are available for an integration BEFORE calling the integration tool.

IMPORTANT: Available integration names are provided in the system context at the start of the conversation.
Check the [INTEGRATIONS] section for the list of configured integrations.

WHAT YOU'LL LEARN:

For REST API integrations:
• Operation names (e.g., "list_products", "get_order")
• Operation descriptions and what they do
• Required and optional parameters for each operation

For SQL integrations:
• Database engine (mssql, postgres, mysql)
• System introspection operations (always available):
  - "introspect_tables": List all tables in the database
  - "introspect_columns": Get column info for a specific table
• User-defined query operations configured by administrators
• Parameter requirements for each query

WORKFLOW:
1. Check the [INTEGRATIONS] context for available integration names
2. Call this tool with an integrationName to see its operations
3. Use the integration tool to execute the desired operation`,

    args: integrationIntrospectArgs,

    handler: async (
      ctx: ToolCtx,
      args,
    ): Promise<IntegrationIntrospectionResult> => {
      const { organizationId } = ctx;

      if (!organizationId) {
        throw new Error(
          'organizationId required in context to introspect integrations',
        );
      }

      // Fetch the specific integration
      const integration = (await ctx.runQuery(
        internal.integrations.getByNameInternal,
        { organizationId, name: args.integrationName },
      )) as Doc<'integrations'> | null;

      if (!integration) {
        throw new Error(
          `Integration not found: "${args.integrationName}"\n\n` +
            `Check the [INTEGRATIONS] section in the system context for available integration names.`,
        );
      }

      const integrationType = (integration as any).type || 'rest_api';

      // Handle SQL integrations
      if (integrationType === 'sql') {
        const sqlConfig = (integration as any).sqlConnectionConfig;
        const sqlOperations = (integration as any).sqlOperations || [];

        // Get introspection operation names (always available for SQL)
        const introspectionOpNames = getIntrospectionOperations();

        // Build introspection operation objects with descriptions
        const introspectionOps = introspectionOpNames.map((name) => ({
          name,
          title: name === 'introspect_tables' ? 'List Tables' : 'List Columns',
          description:
            name === 'introspect_tables'
              ? 'List all tables in the database'
              : 'Get columns for a specific table. Requires params: { schemaName: "...", tableName: "..." }',
          isIntrospection: true,
        }));

        // Strip SQL queries from operations to reduce token usage.
        // AI only needs operation metadata (name, description, parameters) to select and call operations.
        // The actual SQL query is only needed at execution time by the integration tool.
        const operationSummaries = sqlOperations.map((op: any) => ({
          name: op.name,
          title: op.title,
          description: op.description,
          parametersSchema: op.parametersSchema,
          operationType: op.operationType,
        }));

        return {
          type: 'sql',
          integrationName: integration.name,
          title: integration.title,
          description: integration.description,
          engine: sqlConfig.engine,
          operations: [...introspectionOps, ...operationSummaries],
        } as IntegrationIntrospectionResult;
      }

      // Handle REST API integrations
      let connectorConfig = (integration as any).connector;

      if (!connectorConfig) {
        // Fallback to predefined integration
        const predefined = getPredefinedIntegration(args.integrationName);
        if (predefined) {
          connectorConfig = predefined.connector;
        }
      }

      if (!connectorConfig) {
        throw new Error(
          `No connector configuration found for integration "${args.integrationName}"`,
        );
      }

      return {
        type: 'rest_api',
        integrationName: integration.name,
        title: integration.title,
        description: integration.description,
        operations: connectorConfig.operations || [],
      } as IntegrationIntrospectionResult;
    },
  }),
} as const;
