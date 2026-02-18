/**
 * Convex Tool: Integration Introspect
 *
 * Tool for discovering available operations on an integration.
 * Supports two modes:
 * 1. Summary mode (default): Returns lightweight list of operation names
 * 2. Detail mode: Returns full details for a specific operation
 */

import type { ToolCtx } from '@convex-dev/agent';

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ToolDefinition } from '../types';
import type {
  IntrospectionSummaryResult,
  OperationDetailResult,
} from './types';

import { isRecord } from '../../../lib/utils/type-guards';
import { internal } from '../../_generated/api';
import { isSqlIntegration } from '../../integrations/helpers';
import { getIntrospectionOperations } from '../../workflow_engine/action_defs/integration/helpers/get_introspection_operations';

const integrationIntrospectArgs = z.object({
  integrationName: z.string().describe('Integration name to introspect'),
  operation: z
    .string()
    .optional()
    .describe(
      'Get detailed info for a specific operation. Omit for summary list of all operations.',
    ),
});

export const integrationIntrospectTool: ToolDefinition = {
  name: 'integration_introspect',
  tool: createTool({
    description: `Get available operations for an integration.
Returns operation names and types. Use 'operation' param to get parameter details for a specific operation.`,

    args: integrationIntrospectArgs,

    handler: async (
      ctx: ToolCtx,
      args,
    ): Promise<IntrospectionSummaryResult | OperationDetailResult> => {
      const { organizationId } = ctx;

      if (!organizationId) {
        throw new Error(
          'organizationId required in context to introspect integrations',
        );
      }

      // Fetch the specific integration
      const integration = await ctx.runQuery(
        internal.integrations.internal_queries.getByName,
        { organizationId, name: args.integrationName },
      );

      if (!integration) {
        throw new Error(`Integration not found: "${args.integrationName}"`);
      }

      // Handle SQL integrations
      if (isSqlIntegration(integration)) {
        const { sqlOperations } = integration;
        const introspectionOpNames = getIntrospectionOperations();

        // Build introspection operations with their metadata
        const introspectionOps = introspectionOpNames.map((name) => {
          const isTablesOp = name === 'introspect_tables';
          return {
            name,
            title: isTablesOp ? 'List Tables' : 'List Columns',
            description: isTablesOp
              ? 'List all tables in the database'
              : 'Get columns for a specific table',
            operationType: 'read' as const,
            parametersSchema: isTablesOp
              ? undefined
              : {
                  type: 'object',
                  properties: {
                    schemaName: { type: 'string' },
                    tableName: { type: 'string' },
                  },
                  required: ['schemaName', 'tableName'],
                },
          };
        });

        const allOperations = [...introspectionOps, ...sqlOperations];

        // If operation specified, return details for that operation
        if (args.operation) {
          const op = allOperations.find((o) => o.name === args.operation);
          if (!op) {
            throw new Error(
              `Operation "${args.operation}" not found on integration "${args.integrationName}"`,
            );
          }
          return {
            name: op.name,
            title: op.title,
            description: op.description,
            operationType: op.operationType,
            parametersSchema: op.parametersSchema,
          };
        }

        // Return summary list
        return {
          type: 'sql',
          integrationName: integration.name,
          operations: allOperations.map((op) => ({
            name: op.name,
            title: op.title,
            operationType: op.operationType,
          })),
        };
      }

      // Handle REST API integrations
      const connectorConfig = integration.connector;

      if (!connectorConfig) {
        throw new Error(
          `No connector configuration found for integration "${args.integrationName}"`,
        );
      }

      // connectorConfig can come from schema (no operationType) or predefined (has operationType)
      // Cast to a common type that allows optional operationType
      const operations = (connectorConfig.operations || []) as Array<{
        name: string;
        title?: string;
        description?: string;
        parametersSchema?: unknown;
        operationType?: 'read' | 'write';
      }>;

      // If operation specified, return details for that operation
      if (args.operation) {
        const op = operations.find((o) => o.name === args.operation);
        if (!op) {
          throw new Error(
            `Operation "${args.operation}" not found on integration "${args.integrationName}"`,
          );
        }
        return {
          name: op.name,
          title: op.title,
          description: op.description,
          operationType: op.operationType,
          parametersSchema: isRecord(op.parametersSchema)
            ? op.parametersSchema
            : undefined,
        };
      }

      // Return summary list
      return {
        type: 'rest_api',
        integrationName: integration.name,
        operations: operations.map((op) => ({
          name: op.name,
          title: op.title,
          operationType: op.operationType,
        })),
      };
    },
  }),
} as const;
