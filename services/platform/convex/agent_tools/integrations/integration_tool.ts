/**
 * Convex Tool: Integration
 *
 * Unified tool for executing operations on configured integrations.
 * Supports both REST API and SQL integrations without hardcoding.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';
import { internal } from '../../_generated/api';
import type { IntegrationExecutionResult } from './types';

const integrationArgs = z.object({
  integrationName: z
    .string()
    .describe(
      'Name of the configured integration (e.g., "shopify_store", "warehouse_db", "protel_pms")',
    ),
  operation: z
    .string()
    .describe(
      'Operation name to execute on the integration (e.g., "list_orders", "get_customers", "get_reservations"). For SQL integrations, you can use special introspection operations: "introspect_tables" to list all tables, or "introspect_columns" to see columns in a table.',
    ),
  params: z
    .record(z.unknown())
    .optional()
    .describe(
      'Operation-specific parameters as a key-value object. For SQL introspection operations, use: {"schemaName": "dbo", "tableName": "Customers"} for introspect_columns. Check the integration definition or use integration_introspect tool to see required parameters.',
    ),
});

export const integrationTool: ToolDefinition = {
  name: 'integration',
  tool: createTool({
    description: `Execute operations on configured integrations (REST APIs, SQL databases, etc).

This tool provides a unified interface to interact with external systems that have been configured as integrations. It works with ANY integration type without hardcoding.

WHAT THIS TOOL DOES:
• Execute operations on REST API integrations (e.g., Shopify, custom APIs)
• Run queries on SQL database integrations (MSSQL, PostgreSQL, MySQL)
• Introspect SQL database schemas (list tables, view columns)
• Access data from connected external systems

HOW TO USE:
1. Know the integration name (configured in the system settings)
2. Know the operation name (use integration_introspect tool to discover available operations)
3. Pass required parameters for the operation

REST API INTEGRATIONS:
• Operations are defined in the connector code
• Examples: "list_products", "get_order", "create_customer"
• Parameters depend on the specific operation (check integration definition)

SQL INTEGRATIONS:
System introspection operations (available on all SQL integrations):
• "introspect_tables" - List all tables in the database (no params needed)
• "introspect_columns" - Get columns for a specific table
  Required params: { schemaName: "dbo", tableName: "TableName" }

User-defined operations:
• Custom SQL queries configured by administrators
• Examples: "get_reservations", "get_active_orders", "customer_totals"
• Parameters are mapped to SQL query placeholders

WRITE OPERATIONS & APPROVALS:
• Write operations (INSERT, UPDATE, DELETE) require user approval before execution
• When a write operation is requested, an approval card will be shown in the chat
• The user must click "Approve" before the operation is executed
• If the result contains "requiresApproval: true", inform the user that approval is needed
• Do NOT retry the operation - wait for the user to approve via the UI

PRE-VALIDATION (CRITICAL - DO THIS BEFORE WRITE OPERATIONS):
• ALWAYS verify the target record exists BEFORE calling a write operation
• Use the corresponding read operation first (e.g., get_guest before update_guest)
• Check that the record meets operation constraints (e.g., profile type, status)
• If validation fails, inform the user immediately - do NOT create an approval
• This prevents wasting user time approving operations that will fail

Example workflow for update_guest:
1. Call get_guest with the guestId to verify it exists
2. Check that profile_type is 2 (Guest), not 0 (Travel Agent) or 1 (Company)
3. Only if both checks pass, proceed with update_guest

BEST PRACTICES:
• Use integration_introspect tool first to discover available operations
• For SQL databases, use introspect_tables and introspect_columns to understand schema
• Check operation descriptions and parameter schemas before calling
• Handle errors gracefully - integration might be offline or credentials invalid

IMPORTANT NOTES:
• Integrations must be configured before use (contact admin if integration not found)
• SQL queries respect configured security limits (max rows, timeouts)
• REST API calls are sandboxed and rate-limited
• All credentials are handled securely (never exposed to the agent)`,

    args: integrationArgs,

    handler: async (
      ctx: ToolCtx,
      args,
    ): Promise<IntegrationExecutionResult> => {
      const { organizationId } = ctx;

      if (!organizationId) {
        throw new Error(
          'organizationId required in context to execute integrations',
        );
      }

      try {
        // Delegate to the existing integration action logic via internal action wrapper
        // This reuses all validation, credential decryption, and execution logic
        const result = await ctx.runAction(
          internal.agent_tools.integrations.execute_integration_internal
            .executeIntegrationInternal,
          {
            organizationId,
            integrationName: args.integrationName,
            operation: args.operation,
            params: args.params || {},
            threadId: ctx.threadId, // Pass threadId for approval card linking
          },
        );

        // Check if approval is required (write operation)
        // Type guard for approval result
        const isApprovalResult = (r: unknown): r is {
          requiresApproval: true;
          approvalId: string;
          operationName: string;
          operationTitle: string;
          operationType: 'read' | 'write';
          parameters: Record<string, unknown>;
        } => {
          return r !== null && typeof r === 'object' && 'requiresApproval' in r && (r as any).requiresApproval === true;
        };

        if (isApprovalResult(result)) {
          return {
            success: true,
            integration: args.integrationName,
            operation: args.operation,
            requiresApproval: true,
            approvalId: result.approvalId,
            approvalMessage: `This operation requires approval before execution. An approval card has been created for "${result.operationTitle || args.operation}" on ${args.integrationName}. The user can approve or reject this operation in the chat.`,
            data: {
              approvalId: result.approvalId,
              operationName: result.operationName,
              operationTitle: result.operationTitle,
              operationType: result.operationType,
              parameters: result.parameters,
            },
          };
        }

        return {
          success: true,
          integration: args.integrationName,
          operation: args.operation,
          data: result,
        };
      } catch (error) {
        // Provide a helpful error message to the agent
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        throw new Error(
          `Integration operation failed: ${args.integrationName}.${args.operation}\n` +
            `Error: ${errorMessage}\n\n` +
            `Troubleshooting tips:\n` +
            `• Verify the integration name is correct (use integration_introspect tool to list integrations)\n` +
            `• Check if the operation name exists for this integration\n` +
            `• Ensure required parameters are provided\n` +
            `• The integration might be inactive or credentials might be invalid`,
        );
      }
    },
  }),
} as const;
