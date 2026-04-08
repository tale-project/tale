/**
 * Factory for creating MCP-server-bound tools.
 *
 * Creates a createTool() result scoped to a specific MCP server.
 * The serverName and serverId are captured in a closure — the agent only
 * needs to specify the tool name + params.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { toId } from '../../lib/type_cast_helpers';
import { toConvexJsonRecord } from '../../lib/type_cast_helpers';
import { getApprovalThreadId } from '../../threads/get_parent_thread_id';

interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  requiresApproval?: boolean;
}

interface McpToolCallResult {
  success: boolean;
  server: string;
  tool: string;
  data?: unknown;
  requiresApproval?: boolean;
  approvalId?: string;
  approvalCreated?: boolean;
  approvalMessage?: string;
}

/**
 * Convert a JSON Schema property to a Zod schema.
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
    case 'array':
      schema = z.array(z.unknown());
      break;
    case 'object':
      schema = z.record(z.string(), z.unknown());
      break;
    default:
      schema = z.string();
  }
  if (description) schema = schema.describe(description);
  if (!required) schema = schema.optional();
  return schema;
}

/**
 * Build a Zod schema from a JSON Schema object (MCP tool inputSchema).
 */
function buildInputSchemaFromJsonSchema(
  inputSchema: Record<string, unknown>,
): z.ZodTypeAny | undefined {
  const properties = inputSchema.properties;
  if (
    !properties ||
    typeof properties !== 'object' ||
    Array.isArray(properties)
  ) {
    return undefined;
  }

  const requiredFields = new Set(
    Array.isArray(inputSchema.required) ? inputSchema.required : [],
  );

  const entries: [string, z.ZodTypeAny][] = [];
  for (const [name, rawProp] of Object.entries(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON Schema properties object
    properties as Record<string, unknown>,
  )) {
    if (!rawProp || typeof rawProp !== 'object') continue;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by typeof check
    const prop = rawProp as Record<string, unknown>;
    const type = typeof prop.type === 'string' ? prop.type : 'string';
    const desc =
      typeof prop.description === 'string' ? prop.description : undefined;
    entries.push([name, jsonTypeToZod(type, requiredFields.has(name), desc)]);
  }

  if (entries.length === 0) return undefined;
  return z.object(Object.fromEntries(entries));
}

/**
 * Create a tool bound to a specific MCP server tool.
 */
export function createBoundMcpTool(
  serverId: string,
  serverName: string,
  mcpTool: McpToolSchema,
) {
  const description = [
    `Execute "${mcpTool.name}" tool on MCP server "${serverName}".`,
    mcpTool.description ?? '',
  ]
    .filter(Boolean)
    .join('\n');

  const dynamicSchema = mcpTool.inputSchema
    ? buildInputSchemaFromJsonSchema(mcpTool.inputSchema)
    : undefined;
  const inputSchema = dynamicSchema ?? z.record(z.string(), z.unknown());

  return createTool({
    description,
    inputSchema,

    execute: async (ctx: ToolCtx, rawArgs): Promise<McpToolCallResult> => {
      const { organizationId, threadId: currentThreadId, messageId } = ctx;

      if (!organizationId) {
        throw new Error(
          'organizationId required in context to execute MCP tools',
        );
      }

      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic schema produces unknown; shape is always Record<string, unknown>
      const args = (rawArgs ?? {}) as Record<string, unknown>;

      // Check if this tool requires approval
      if (mcpTool.requiresApproval) {
        const threadId = await getApprovalThreadId(ctx, currentThreadId);

        const approvalId: string = await ctx.runMutation(
          internal.approvals.internal_mutations.createApproval,
          {
            organizationId,
            resourceType: 'mcp_tool_call',
            resourceId: `${serverId}:${mcpTool.name}`,
            priority: 'medium',
            threadId,
            messageId,
            metadata: toConvexJsonRecord({
              serverId,
              serverName,
              toolName: mcpTool.name,
              toolDescription: mcpTool.description,
              parameters: args,
              requestedAt: Date.now(),
            }),
          },
        );

        return {
          success: true,
          server: serverName,
          tool: mcpTool.name,
          requiresApproval: true,
          approvalId,
          approvalCreated: true,
          approvalMessage: `APPROVAL CREATED SUCCESSFULLY: An approval card (ID: ${approvalId}) has been created for "${mcpTool.name}" on MCP server "${serverName}". The user must approve or reject this operation before it will be executed. Do NOT include suggested follow-ups or next steps — the user needs to act on the approval card first.`,
        };
      }

      // Execute directly
      try {
        const result = await ctx.runAction(
          internal.mcp_servers.actions.executeMcpTool,
          {
            serverId: toId<'mcpServers'>(serverId),
            toolName: mcpTool.name,
            toolArgs: toConvexJsonRecord(args),
          },
        );

        return {
          success: true,
          server: serverName,
          tool: mcpTool.name,
          data: result,
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        throw new Error(
          `MCP tool execution failed: ${serverName}.${mcpTool.name}\n` +
            `Error: ${errorMessage}`,
          { cause: error },
        );
      }
    },
  });
}
