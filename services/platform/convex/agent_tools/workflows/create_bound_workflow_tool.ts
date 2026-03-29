/**
 * Factory for creating workflow-bound tools.
 *
 * Creates a createTool() result scoped to a specific workflow.
 * The workflowSlug is captured in a closure — the agent only needs
 * to specify parameters.
 */

import type { ToolCtx } from '@convex-dev/agent';

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { WorkflowJsonConfig } from '../../../lib/shared/schemas/workflows';
import type { WorkflowInputSchema } from '../../workflow_engine/helpers/validation/validate_workflow_input';

import { isRecord } from '../../../lib/utils/type-guards';
import { internal } from '../../_generated/api';
import { getApprovalThreadId } from '../../threads/get_parent_thread_id';
import { validateWorkflowInput } from '../../workflow_engine/helpers/validation/validate_workflow_input';
import { extractInputSchema } from './helpers/extract_input_schema';

interface BoundWorkflowDefinition {
  workflowSlug: string;
  name: string;
  description?: string;
}

// WORKAROUND (partial): z.unknown() and z.record(z.string(), z.unknown())
// produce broken JSON Schema after AI SDK post-processing because
// addAdditionalPropertiesToJsonSchema() unconditionally sets
// additionalProperties: false on all object types.
// - z.record() → { type: "object", additionalProperties: false } (empty!)
// - z.object({}) → same problem
// However, z.object() WITH explicit properties is fine — the AI SDK adds
// additionalProperties: false which is correct for fixed-shape objects.
// So we only fall back to z.string() for opaque objects without properties.
// See: @ai-sdk/provider-utils/src/add-additional-properties-to-json-schema.ts
const JSON_VALUE = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const PRIMITIVE_ZOD_MAP: Record<string, () => z.ZodTypeAny> = {
  string: () => z.string(),
  number: () => z.number(),
  integer: () => z.number().int(),
  boolean: () => z.boolean(),
};

interface NestedProperty {
  type: string;
  description?: string;
}

interface SchemaProperty {
  type: string;
  description?: string;
  properties?: Record<string, NestedProperty>;
  required?: string[];
  items?: {
    type: string;
    properties?: Record<string, NestedProperty>;
    required?: string[];
  };
}

function buildNestedObjectSchema(
  properties: Record<string, NestedProperty>,
  required?: string[],
): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, nested] of Object.entries(properties)) {
    let field = (PRIMITIVE_ZOD_MAP[nested.type] ?? (() => z.string()))();
    if (nested.description) field = field.describe(nested.description);
    if (!required?.includes(name)) field = field.optional();
    shape[name] = field;
  }
  return z.object(shape);
}

function buildZodType(prop: SchemaProperty): z.ZodTypeAny {
  if (prop.type === 'object') {
    if (prop.properties && Object.keys(prop.properties).length > 0) {
      return buildNestedObjectSchema(prop.properties, prop.required);
    }
    return z.string().describe('JSON object as string');
  }

  if (prop.type === 'array') {
    if (prop.items) {
      if (
        prop.items.type === 'object' &&
        prop.items.properties &&
        Object.keys(prop.items.properties).length > 0
      ) {
        return z.array(
          buildNestedObjectSchema(prop.items.properties, prop.items.required),
        );
      }
      const itemFactory = PRIMITIVE_ZOD_MAP[prop.items.type];
      if (itemFactory) return z.array(itemFactory());
    }
    return z.array(JSON_VALUE);
  }

  return (PRIMITIVE_ZOD_MAP[prop.type] ?? (() => z.unknown()))();
}

function buildArgsSchema(inputSchema: WorkflowInputSchema | undefined) {
  if (!inputSchema || Object.keys(inputSchema.properties).length === 0) {
    return z.object({});
  }

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, prop] of Object.entries(inputSchema.properties)) {
    let field = buildZodType(prop);
    if (prop.description) field = field.describe(prop.description);
    if (!inputSchema.required?.includes(name)) field = field.optional();
    shape[name] = field;
  }
  return z.object(shape);
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Normalize args for cross-model resilience.
 *
 * Some models stringify objects despite receiving a proper z.object() schema.
 * This function JSON.parses string values where the runtime schema expects
 * object or array types. Only targets fields where the schema declares
 * object/array — never touches string fields.
 */
function normalizeArgs(
  args: Record<string, unknown>,
  inputSchema: WorkflowInputSchema,
): Record<string, unknown> {
  const result = { ...args };
  for (const [field, schema] of Object.entries(inputSchema.properties)) {
    const value = result[field];
    if (typeof value === 'string') {
      if (schema.type === 'object' || schema.type === 'array') {
        result[field] = tryParseJson(value);
      }
      continue;
    }
    if (
      schema.type === 'array' &&
      Array.isArray(value) &&
      schema.items?.type === 'object'
    ) {
      result[field] = (value as unknown[]).map((item) =>
        typeof item === 'string' ? tryParseJson(item) : item,
      );
    }
  }
  return result;
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
    inputSchema: argsSchema,

    execute: async (
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

      const result: unknown = await ctx.runAction(
        internal.workflows.file_actions.readWorkflowForExecution,
        { orgSlug: 'default', workflowSlug: wfDefinition.workflowSlug },
      );

      if (!isRecord(result) || result.ok !== true) {
        const msg =
          isRecord(result) && typeof result.message === 'string'
            ? result.message
            : `Workflow "${wfDefinition.name}" is no longer available.`;
        return { success: false, message: msg };
      }

      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- readWorkflowForExecution returns v.any() but ok=true guarantees WorkflowJsonConfig
      const config = result.config as WorkflowJsonConfig;

      if (!config.enabled) {
        return {
          success: false,
          message: `Workflow "${wfDefinition.name}" is disabled and cannot be executed.`,
        };
      }

      const startStep = config.steps.find((s) => s.stepType === 'start');
      const runtimeInputSchema = extractInputSchema(startStep?.config);
      const normalizedArgs = runtimeInputSchema
        ? normalizeArgs(args, runtimeInputSchema)
        : args;
      const validation = validateWorkflowInput(
        normalizedArgs,
        runtimeInputSchema,
      );

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
            workflowSlug: wfDefinition.workflowSlug,
            workflowName: config.name,
            workflowDescription: config.description,
            parameters: normalizedArgs,
            threadId,
            messageId,
          },
        );

        return {
          success: true,
          requiresApproval: true,
          approvalId,
          approvalCreated: true,
          approvalMessage: `APPROVAL CREATED SUCCESSFULLY: An approval card (ID: ${approvalId}) has been created to run workflow "${config.name}". The user must approve this before execution begins.`,
          message: `Workflow "${config.name}" is ready to run. An approval card has been created. The workflow will start once the user approves it.`,
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

function buildDescription(
  wfDefinition: BoundWorkflowDefinition,
  inputSchema: WorkflowInputSchema | undefined,
): string {
  const lines = [`Run the "${wfDefinition.name}" workflow.`];

  if (wfDefinition.description) {
    lines.push('', wfDefinition.description);
  }

  if (inputSchema && Object.keys(inputSchema.properties).length > 0) {
    lines.push('', 'Input schema:', JSON.stringify(inputSchema, null, 2));
  }

  lines.push(
    '',
    'This creates an approval card. Do NOT mention its position. The user must approve before execution begins.',
  );

  return lines.join('\n');
}
