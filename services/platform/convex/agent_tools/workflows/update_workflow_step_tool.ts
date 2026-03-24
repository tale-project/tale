/**
 * Convex Tool: Update Workflow Step
 *
 * Updates one or more workflow steps with built-in validation.
 * Requires user approval before changes are applied.
 * Supports both single-step and batch updates.
 */

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ToolDefinition } from '../types';

import { isRecord } from '../../../lib/utils/type-guards';
import { internal } from '../../_generated/api';
import { createDebugLog } from '../../lib/debug_log';
import { toId } from '../../lib/type_cast_helpers';
import { getApprovalThreadId } from '../../threads/get_parent_thread_id';
import {
  validateStepConfig,
  isValidStepType,
} from '../../workflow_engine/helpers/validation/validate_step_config';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

const stepUpdatesSchema = z.object({
  name: z.string().optional().describe('New step name'),
  stepType: z
    .enum(['start', 'llm', 'action', 'condition', 'loop'])
    .optional()
    .describe(
      'New step type. Options: start (workflow entry point, optional inputSchema), llm (AI agent with tools), action (database/API operations), condition (branching logic), loop (iterate over collections)',
    ),
  config: z
    .any()
    .optional()
    .describe(
      'Updated config object. Must include ALL required fields for the step type.',
    ),
  nextSteps: z
    .any()
    .optional()
    .describe(
      'Updated next step connections. IMPORTANT: This is a TOP-LEVEL field in updates, NOT inside config! Keys are outcomes (e.g., "success", "failure", "true", "false"), values are stepSlugs to execute next. Example: { success: "send_email", failure: "log_error" }',
    ),
});

/**
 * Sanitize and repair malformed JSON from LLM output.
 * Handles corrupted field names with control characters or excessive lengths.
 */
function sanitizeUpdates<T>(updates: T): T {
  // Deep clone and re-parse to ensure clean JSON structure
  const jsonStr = JSON.stringify(updates);
  let sanitized: T = JSON.parse(jsonStr);

  // Generic preserves input type — structural shape is maintained by key repair
  const repairObject = <U>(obj: U): U => {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    // Handle arrays by recursively repairing each element
    if (Array.isArray(obj)) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- generic T preserves structural shape through array repair
      return obj.map((item) => repairObject(item)) as U;
    }

    const repaired: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- iterating Convex document fields; structural shape is Record<string, unknown>
      obj as Record<string, unknown>,
    )) {
      let repairedKey = key;

      // If key contains newlines or is too descriptive, try to extract the actual field name
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Intentionally matching control characters to detect and repair corrupted field names
      if (/[\x00-\x1F\x7F]/.test(key) || key.length > 50) {
        // Try to extract common field names from descriptive keys
        const fieldNameMatch = key.match(
          /^(config|userPrompt|systemPrompt|name|parameters|type|nextSteps|stepType)/i,
        );
        if (fieldNameMatch) {
          // Normalize to proper camelCase
          const lowerKey = fieldNameMatch[1].toLowerCase();
          const camelCaseMap: Record<string, string> = {
            userprompt: 'userPrompt',
            systemprompt: 'systemPrompt',
            nextsteps: 'nextSteps',
            steptype: 'stepType',
          };
          repairedKey = camelCaseMap[lowerKey] ?? lowerKey;
          debugLog('Repaired field name', {
            original: key.slice(0, 50),
            repaired: repairedKey,
          });
        } else {
          // Can't repair this key, leave it as-is for validation to catch
          repairedKey = key;
        }
      }

      repaired[repairedKey] =
        typeof value === 'object' && value !== null
          ? repairObject(value)
          : value;
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- generic T preserves structural shape through key repair
    return repaired as U;
  };

  sanitized = repairObject(sanitized);

  // Validate: check for extremely long field names and invalid characters
  const validateObject = (obj: unknown, path = ''): void => {
    if (!obj || typeof obj !== 'object') return;

    // Handle arrays by recursively validating each element
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => validateObject(item, `${path}[${index}]`));
      return;
    }

    for (const [key, value] of Object.entries(obj)) {
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Intentionally matching control characters to reject them
      const hasControlChars = /[\x00-\x1F\x7F]/.test(key);
      if (hasControlChars) {
        const escapedKey = JSON.stringify(key).slice(1, -1);
        throw new Error(
          `Invalid field name contains control characters: "${escapedKey.slice(0, 50)}${escapedKey.length > 50 ? '...' : ''}". Field names cannot contain newlines, tabs, or other control characters. This indicates malformed JSON from the LLM.`,
        );
      }

      if (key.length > 100) {
        throw new Error(
          `Invalid field name detected (length: ${key.length}). This usually indicates malformed JSON from the LLM. Field path: ${path}.${key.slice(0, 50)}...`,
        );
      }

      if (typeof value === 'object' && value !== null) {
        validateObject(value, path ? `${path}.${key}` : key);
      }
    }
  };

  validateObject(sanitized);
  return sanitized;
}

function validateStepUpdates(updates: {
  name?: string;
  stepType?: string;
  config?: unknown;
}): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (updates.stepType && updates.config) {
    const stepValidation = validateStepConfig({
      stepSlug: 'update',
      name: updates.name ?? 'Step',
      stepType: updates.stepType,
      config: updates.config,
    });

    if (!stepValidation.valid) {
      errors.push(...stepValidation.errors);
    }
    if (stepValidation.warnings) {
      warnings.push(...stepValidation.warnings);
    }

    const config = isRecord(updates.config) ? updates.config : undefined;
    if (
      updates.stepType === 'action' &&
      config &&
      'type' in config &&
      typeof config.type === 'string'
    ) {
      const actionType = config.type;
      if (isValidStepType(actionType)) {
        warnings.push(
          `Action type "${actionType}" matches a stepType name. Did you mean stepType: "${actionType}"?`,
        );
      }
    }
  }

  return { errors, warnings };
}

export const updateWorkflowStepTool = {
  name: 'update_workflow_step' as const,
  tool: createTool({
    description: `Update one or more workflow steps. Requires user approval — an approval card will be created.

**SINGLE STEP:**
{ stepRecordId: "...", updates: { stepType: "...", config: {...}, nextSteps: {...} }, updateSummary: "..." }

**BATCH (multiple steps in same workflow):**
{ steps: [{ stepRecordId: "...", updates: {...} }, ...], updateSummary: "..." }

**REQUIRED STEPS:**
1. Call workflow_read(operation='get_step', stepId='...') to get current config for each step
2. Modify config based on current values (keep ALL required fields)
3. Call this tool with the updates

**APPROVAL:**
When this tool returns { requiresApproval: true }, do NOT call this tool again.
Inform the user the update is ready for review in the chat UI.`,
    inputSchema: z.object({
      stepRecordId: z
        .string()
        .optional()
        .describe(
          'The step record ID for single-step update. Omit when using batch mode.',
        ),
      updates: stepUpdatesSchema
        .optional()
        .describe('Fields to update for single-step mode.'),
      steps: z
        .array(
          z.object({
            stepRecordId: z
              .string()
              .describe('The step record ID (Convex Id<"wfStepDefs">)'),
            updates: stepUpdatesSchema.describe('Fields to update'),
          }),
        )
        .optional()
        .describe(
          'Array of steps to update in batch mode. All steps must belong to the same workflow.',
        ),
      updateSummary: z
        .string()
        .describe(
          'Markdown-formatted summary of changes. Use bullet points for multiple changes.',
        ),
    }),
    execute: async (
      ctx,
      args,
    ): Promise<{
      success: boolean;
      requiresApproval?: boolean;
      approvalId?: string;
      approvalCreated?: boolean;
      approvalMessage?: string;
      message: string;
      step?: null;
      validationErrors?: string[];
      validationWarnings?: string[];
    }> => {
      const { organizationId, threadId: currentThreadId, messageId } = ctx;

      if (!organizationId) {
        return {
          success: false,
          message:
            'organizationId is required in the tool context to update a workflow step.',
          step: null,
        };
      }

      const threadId = await getApprovalThreadId(ctx, currentThreadId);

      // Determine mode: batch vs single
      const isBatch = Array.isArray(args.steps) && args.steps.length > 0;

      if (!isBatch && !args.stepRecordId) {
        return {
          success: false,
          message:
            'Either stepRecordId (single mode) or steps array (batch mode) is required.',
          step: null,
        };
      }

      if (!isBatch && !args.updates) {
        return {
          success: false,
          message: 'updates is required for single-step mode.',
          step: null,
        };
      }

      // Normalize to array of step entries (guards above ensure values exist)
      const stepEntries = isBatch
        ? (args.steps ?? []).map((s) => ({
            stepRecordId: s.stepRecordId,
            updates: s.updates,
          }))
        : [
            {
              stepRecordId: args.stepRecordId ?? '',
              updates: args.updates ?? {},
            },
          ];

      // Sanitize and validate each step's updates
      const sanitizedEntries: Array<{
        stepRecordId: string;
        updates: z.infer<typeof stepUpdatesSchema>;
      }> = [];

      for (const entry of stepEntries) {
        try {
          const sanitized = sanitizeUpdates(entry.updates);
          sanitizedEntries.push({
            stepRecordId: entry.stepRecordId,
            updates: sanitized,
          });
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          return {
            success: false,
            message: `Failed to parse tool arguments for step "${entry.stepRecordId}": ${errorMsg}\n\nPlease try again with properly structured JSON.`,
            step: null,
            validationErrors: [errorMsg],
          };
        }
      }

      // Validate step configs
      const allErrors: string[] = [];
      const allWarnings: string[] = [];
      for (const entry of sanitizedEntries) {
        const { errors, warnings } = validateStepUpdates(entry.updates);
        allErrors.push(...errors);
        allWarnings.push(...warnings);
      }

      if (allErrors.length > 0) {
        return {
          success: false,
          message: `Step validation failed with ${allErrors.length} error(s). Fix the errors and try again.`,
          step: null,
          validationErrors: allErrors,
          validationWarnings: allWarnings.length > 0 ? allWarnings : undefined,
        };
      }

      // Look up all steps and verify they belong to the same workflow
      const stepInfos = await Promise.all(
        sanitizedEntries.map(async (entry) => {
          const info = await ctx.runQuery(
            internal.wf_step_defs.internal_queries.getStepWithWorkflowInfo,
            { stepId: toId<'wfStepDefs'>(entry.stepRecordId) },
          );
          return { entry, info };
        }),
      );

      // Check all steps exist and build verified list
      const verifiedSteps: Array<{
        entry: (typeof sanitizedEntries)[number];
        info: NonNullable<(typeof stepInfos)[number]['info']>;
      }> = [];

      for (const { entry, info } of stepInfos) {
        if (!info) {
          return {
            success: false,
            message: `Step "${entry.stepRecordId}" not found or its parent workflow was deleted.`,
            step: null,
          };
        }
        verifiedSteps.push({ entry, info });
      }

      // Verify all steps belong to the same workflow (for batch)
      if (verifiedSteps.length > 1) {
        const workflowIds = new Set(
          verifiedSteps.map((s) => s.info.workflowId),
        );
        if (workflowIds.size > 1) {
          return {
            success: false,
            message:
              'All steps in a batch update must belong to the same workflow.',
            step: null,
          };
        }
      }

      const firstInfo = verifiedSteps[0].info;

      try {
        if (isBatch) {
          // Batch mode: create single approval for all steps
          const approvalId = await ctx.runMutation(
            internal.agent_tools.workflows.internal_mutations
              .createBatchWorkflowStepUpdateApproval,
            {
              organizationId,
              workflowId: firstInfo.workflowId,
              workflowName: firstInfo.workflowName,
              workflowVersionNumber: firstInfo.workflowVersionNumber,
              updateSummary: args.updateSummary,
              steps: verifiedSteps.map(({ entry, info }) => ({
                stepRecordId: toId<'wfStepDefs'>(entry.stepRecordId),
                stepName: info.step.name,
                stepUpdates: entry.updates,
              })),
              threadId,
              messageId,
            },
          );

          debugLog('batch update_workflow_step approval created', {
            stepCount: verifiedSteps.length,
            approvalId,
          });

          const stepNames = verifiedSteps
            .map(({ info }) => `"${info.step.name}"`)
            .join(', ');

          return {
            success: true,
            requiresApproval: true,
            approvalId,
            approvalCreated: true,
            approvalMessage: `APPROVAL CREATED SUCCESSFULLY: An approval card (ID: ${approvalId}) has been created for updating ${stepInfos.length} steps (${stepNames}) in workflow "${firstInfo.workflowName}".`,
            message: `Batch step update for ${stepInfos.length} steps is ready for approval. An approval card has been created.`,
          };
        } else {
          // Single step mode: existing behavior
          const entry = sanitizedEntries[0];
          const approvalId = await ctx.runMutation(
            internal.agent_tools.workflows.internal_mutations
              .createWorkflowStepUpdateApproval,
            {
              organizationId,
              workflowId: firstInfo.workflowId,
              workflowName: firstInfo.workflowName,
              workflowVersionNumber: firstInfo.workflowVersionNumber,
              updateSummary: args.updateSummary,
              stepRecordId: toId<'wfStepDefs'>(entry.stepRecordId),
              stepName: firstInfo.step.name,
              stepUpdates: entry.updates,
              threadId,
              messageId,
            },
          );

          debugLog('update_workflow_step approval created', {
            stepRecordId: entry.stepRecordId,
            approvalId,
          });

          return {
            success: true,
            requiresApproval: true,
            approvalId,
            approvalCreated: true,
            approvalMessage: `APPROVAL CREATED SUCCESSFULLY: An approval card (ID: ${approvalId}) has been created for updating step "${firstInfo.step.name}" in workflow "${firstInfo.workflowName}". The user must approve this update before changes will be applied.`,
            message: `Step update for "${firstInfo.step.name}" is ready for approval. An approval card has been created. Changes will be applied once the user approves it.`,
          };
        }
      } catch (error) {
        return {
          success: false,
          message: `Failed to create step update approval: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
          step: null,
        };
      }
    },
  }),
} as const satisfies ToolDefinition;
