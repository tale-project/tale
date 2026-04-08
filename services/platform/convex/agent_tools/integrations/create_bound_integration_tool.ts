/**
 * Factory for creating integration-bound tools.
 *
 * Creates a createTool() result scoped to a specific integration.
 * The integrationName is captured in a closure — the agent only needs
 * to specify operation + params.
 */

import type { ToolCtx } from '@convex-dev/agent';

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { OperationInfo } from './fetch_operations_summary';
import type { IntegrationExecutionResult } from './types';

import { getBoolean, isRecord } from '../../../lib/utils/type-guards';
import { internal } from '../../_generated/api';
import { getApprovalThreadId } from '../../threads/get_parent_thread_id';

interface ApprovalResult {
  requiresApproval: true;
  approvalId: string;
  operationName: string;
  operationTitle: string;
  operationType: 'read' | 'write';
  parameters: Record<string, unknown>;
}

const isApprovalResult = (r: unknown): r is ApprovalResult =>
  isRecord(r) && getBoolean(r, 'requiresApproval') === true;

const fallbackArgs = z.object({
  operation: z
    .string()
    .describe(
      'Operation name to execute (see available operations in description)',
    ),
  params: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Operation parameters as a JSON object. ' +
        'IMPORTANT: Include all required parameters for the operation.',
    ),
});

/**
 * Convert a JSON Schema property type + required flag to a Zod schema.
 */
function jsonTypeToZod(
  type: string,
  required: boolean,
  description?: string,
): z.ZodTypeAny {
  let schema: z.ZodTypeAny;
  switch (type) {
    case 'number':
    case 'integer':
      schema = z.number();
      break;
    case 'boolean':
      schema = z.boolean();
      break;
    default:
      schema = z.string();
  }
  if (description) schema = schema.describe(description);
  if (!required) schema = schema.optional();
  return schema;
}

/**
 * Build a discriminated union Zod schema from integration operations.
 * Each operation variant has typed params based on its parametersSchema.
 */
function buildDynamicInputSchema(
  operations: OperationInfo[],
): z.ZodTypeAny | undefined {
  if (operations.length === 0) return undefined;

  const variants: z.ZodObject<z.ZodRawShape>[] = [];

  for (const op of operations) {
    const properties = op.parametersSchema?.properties;
    let paramsSchema: z.ZodTypeAny | undefined;

    if (
      properties &&
      typeof properties === 'object' &&
      !Array.isArray(properties)
    ) {
      const paramEntries: [string, z.ZodTypeAny][] = [];
      for (const [name, rawProp] of Object.entries(properties)) {
        if (!rawProp || typeof rawProp !== 'object') continue;
        const prop = rawProp as Record<string, unknown>;
        const type = typeof prop.type === 'string' ? prop.type : 'string';
        const required = prop.required === true;
        const desc =
          typeof prop.description === 'string' ? prop.description : undefined;
        paramEntries.push([name, jsonTypeToZod(type, required, desc)]);
      }
      if (paramEntries.length > 0) {
        paramsSchema = z
          .object(Object.fromEntries(paramEntries))
          .describe('Operation parameters');
      }
    }

    const variant = paramsSchema
      ? z.object({ operation: z.literal(op.name), params: paramsSchema })
      : z.object({ operation: z.literal(op.name) });

    variants.push(variant);
  }

  if (variants.length === 0) return undefined;
  if (variants.length === 1) return variants[0];

  // z.discriminatedUnion requires at least 2 variants
  return z.discriminatedUnion(
    'operation',
    variants as [
      z.ZodObject<z.ZodRawShape>,
      z.ZodObject<z.ZodRawShape>,
      ...z.ZodObject<z.ZodRawShape>[],
    ],
  );
}

/**
 * Create a tool bound to a specific integration.
 *
 * @param integrationName - The integration name (baked into the tool)
 * @param operationsSummary - Concise operations list for the tool description
 * @param operations - Operations array for building typed input schema
 * @returns A createTool() result ready to be added to extraTools
 */
export function createBoundIntegrationTool(
  integrationName: string,
  operationsSummary?: string,
  operations?: OperationInfo[],
  metadata?: Record<string, unknown>,
) {
  const description = buildDescription(
    integrationName,
    operationsSummary,
    metadata,
  );
  const dynamicSchema = operations
    ? buildDynamicInputSchema(operations)
    : undefined;
  const inputSchema = dynamicSchema ?? fallbackArgs;

  return createTool({
    description,
    inputSchema,

    execute: async (
      ctx: ToolCtx,
      rawArgs,
    ): Promise<IntegrationExecutionResult> => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic schema produces unknown; shape is always { operation, params? }
      const args = rawArgs as {
        operation: string;
        params?: Record<string, unknown>;
      };
      const { organizationId, threadId: currentThreadId, messageId } = ctx;

      if (!organizationId) {
        throw new Error(
          'organizationId required in context to execute integrations',
        );
      }

      const threadId = await getApprovalThreadId(ctx, currentThreadId);

      try {
        const result = await ctx.runAction(
          internal.agent_tools.integrations.internal_actions.executeIntegration,
          {
            organizationId,
            integrationName,
            operation: args.operation,
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Zod-validated params is Record<string, unknown>; narrowing to primitive values for Convex serialization
            params: (args.params || {}) as Record<
              string,
              string | number | boolean | null
            >,
            threadId,
            messageId,
          },
        );

        if (isApprovalResult(result)) {
          return {
            success: true,
            integration: integrationName,
            operation: args.operation,
            requiresApproval: true,
            approvalId: result.approvalId,
            approvalCreated: true,
            approvalMessage: `APPROVAL CREATED SUCCESSFULLY: An approval card (ID: ${result.approvalId}) has been created for "${result.operationTitle || args.operation}" on ${integrationName}. The user must approve or reject this operation before it will be executed.`,
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
          integration: integrationName,
          operation: args.operation,
          data: result,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        throw new Error(
          `Integration operation failed: ${integrationName}.${args.operation}\n` +
            `Error: ${errorMessage}\n\n` +
            `Troubleshooting:\n` +
            `• Check if the operation name exists for this integration\n` +
            `• Ensure required parameters are provided`,
          { cause: error },
        );
      }
    },
  });
}

function buildDescription(
  integrationName: string,
  operationsSummary?: string,
  metadata?: Record<string, unknown>,
): string {
  const lines = [`Execute operations on the "${integrationName}" integration.`];

  // Include all string metadata as context for the AI (model, modelCapabilities, etc.)
  if (metadata) {
    for (const [key, value] of Object.entries(metadata)) {
      if (typeof value === 'string' && value) {
        lines.push(`${key}: ${value}`);
      }
    }
  }

  if (operationsSummary) {
    lines.push('', operationsSummary);
  }

  lines.push(
    '',
    `Usage: { operation: "operation_name", params: { ... } }`,
    'Write operations create approval cards for user review.',
  );

  return lines.join('\n');
}
