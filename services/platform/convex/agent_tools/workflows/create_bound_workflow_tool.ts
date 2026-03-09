/**
 * Factory for creating workflow-bound tools.
 *
 * Creates a createTool() result scoped to a specific workflow.
 * The workflowId is captured in a closure — the agent only needs
 * to specify parameters.
 */

import type { ToolCtx } from '@convex-dev/agent';

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { Id } from '../../_generated/dataModel';
import type { WorkflowInputSchema } from '../../workflow_engine/helpers/validation/validate_workflow_input';

import { internal } from '../../_generated/api';
import { toId } from '../../lib/type_cast_helpers';
import { getApprovalThreadId } from '../../threads/get_parent_thread_id';
import { validateWorkflowInput } from '../../workflow_engine/helpers/validation/validate_workflow_input';
import { extractInputSchema } from './helpers/extract_input_schema';

interface BoundWorkflowDefinition {
  _id: Id<'wfDefinitions'>;
  name: string;
  description?: string;
}

const ZOD_TYPE_MAP: Record<string, () => z.ZodTypeAny> = {
  string: () => z.string(),
  number: () => z.number(),
  integer: () => z.number().int(),
  boolean: () => z.boolean(),
  array: () => z.array(z.unknown()),
  object: () => z.record(z.string(), z.unknown()),
};

function buildArgsSchema(inputSchema: WorkflowInputSchema | undefined) {
  if (!inputSchema || Object.keys(inputSchema.properties).length === 0) {
    return z.object({});
  }

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, prop] of Object.entries(inputSchema.properties)) {
    let field = (ZOD_TYPE_MAP[prop.type] ?? (() => z.unknown()))();
    if (prop.description) field = field.describe(prop.description);
    if (!inputSchema.required?.includes(name)) field = field.optional();
    shape[name] = field;
  }
  return z.object(shape);
}

/**
 * Create a tool bound to a specific workflow.
 *
 * @param wfDefinition - The workflow definition (name, id, description)
 * @param inputSchema - The start step's input schema (for description and validation)
 * @returns A createTool() result ready to be added to extraTools
 */
export function createBoundWorkflowTool(
  wfDefinition: BoundWorkflowDefinition,
  inputSchema: WorkflowInputSchema | undefined,
) {
  const description = buildDescription(wfDefinition, inputSchema);
  const argsSchema = buildArgsSchema(inputSchema);

  return createTool({
    description,
    args: argsSchema,

    handler: async (
      ctx: ToolCtx,
      args,
    ): Promise<{
      success: boolean;
      requiresApproval?: boolean;
      approvalId?: string;
      approvalCreated?: boolean;
      approvalMessage?: string;
      message: string;
    }> => {
      const { organizationId, threadId: currentThreadId, messageId } = ctx;

      if (!organizationId) {
        return {
          success: false,
          message:
            'organizationId is required in the tool context to run a workflow.',
        };
      }

      const resolvedWf = await ctx.runQuery(
        internal.wf_definitions.internal_queries.resolveWorkflow,
        { wfDefinitionId: toId<'wfDefinitions'>(String(wfDefinition._id)) },
      );

      if (!resolvedWf) {
        return {
          success: false,
          message: `Workflow "${wfDefinition.name}" is no longer available.`,
        };
      }

      if (resolvedWf.organizationId !== organizationId) {
        return {
          success: false,
          message: `Workflow "${wfDefinition.name}" does not belong to the current organization.`,
        };
      }

      if (resolvedWf.status === 'archived') {
        return {
          success: false,
          message: `Workflow "${wfDefinition.name}" is archived and cannot be executed.`,
        };
      }

      const startStepConfig = await ctx.runQuery(
        internal.wf_definitions.internal_queries.getStartStepConfig,
        { wfDefinitionId: resolvedWf._id },
      );

      const runtimeInputSchema = extractInputSchema(startStepConfig);
      const validation = validateWorkflowInput(args, runtimeInputSchema);

      if (!validation.valid) {
        return {
          success: false,
          message: `Invalid workflow parameters: ${validation.errors.join('; ')}`,
        };
      }

      const threadId = await getApprovalThreadId(ctx, currentThreadId);

      try {
        const approvalId = await ctx.runMutation(
          internal.agent_tools.workflows.internal_mutations
            .createWorkflowRunApproval,
          {
            organizationId,
            workflowId: resolvedWf._id,
            workflowName: resolvedWf.name,
            workflowDescription: resolvedWf.description,
            parameters: args,
            threadId,
            messageId,
          },
        );

        return {
          success: true,
          requiresApproval: true,
          approvalId,
          approvalCreated: true,
          approvalMessage: `APPROVAL CREATED SUCCESSFULLY: An approval card (ID: ${approvalId}) has been created to run workflow "${resolvedWf.name}". The user must approve this in the chat UI before execution begins.`,
          message: `Workflow "${resolvedWf.name}" is ready to run. An approval card has been created. The workflow will start once the user approves it.`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to create workflow run approval: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        };
      }
    },
  });
}

export function sanitizeWorkflowName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '');
}

function formatInputSchema(inputSchema: WorkflowInputSchema): string {
  const lines: string[] = [];
  for (const [name, schema] of Object.entries(inputSchema.properties)) {
    const required = inputSchema.required?.includes(name);
    let line = `  - ${name} (${schema.type}${required ? ', required' : ''})`;
    if (schema.description) {
      line += `: ${schema.description}`;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

function buildDescription(
  wfDefinition: BoundWorkflowDefinition,
  inputSchema: WorkflowInputSchema | undefined,
): string {
  const lines = [`Run the "${wfDefinition.name}" workflow.`];

  if (wfDefinition.description) {
    lines.push('', wfDefinition.description);
  }

  if (inputSchema && Object.keys(inputSchema.properties).length > 0) {
    lines.push('', 'Input parameters:', formatInputSchema(inputSchema));
  }

  lines.push(
    '',
    'This creates an approval card. The user must approve before execution begins.',
  );

  return lines.join('\n');
}
