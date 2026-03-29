/**
 * Convex Tool: Update Workflow Step
 *
 * Updates one or more workflow steps with built-in validation.
 * Requires user approval before changes are applied.
 * Supports both single-step and batch updates.
 */

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { WorkflowJsonConfig } from '../../../lib/shared/schemas/workflows';
import type { ToolDefinition } from '../types';

import { isRecord } from '../../../lib/utils/type-guards';
import { internal } from '../../_generated/api';
import { createDebugLog } from '../../lib/debug_log';
import { getApprovalThreadId } from '../../threads/get_parent_thread_id';
import {
  validateStepConfig,
  isValidStepType,
} from '../../workflow_engine/helpers/validation/validate_step_config';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

const DEFAULT_ORG_SLUG = 'default';

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
{ workflowSlug: "...", stepSlug: "...", updates: { stepType: "...", config: {...}, nextSteps: {...} }, updateSummary: "..." }

**BATCH (multiple steps in same workflow):**
{ workflowSlug: "...", steps: [{ stepSlug: "...", updates: {...} }, ...], updateSummary: "..." }

**REQUIRED STEPS:**
1. Call workflow_read(operation='get_structure', workflowSlug='...') to get the workflow and all its steps
2. Modify config based on current values (keep ALL required fields)
3. Call this tool with the updates

**APPROVAL:**
When this tool returns { requiresApproval: true }, do NOT call this tool again.
Inform the user the update is ready for review in the chat UI.`,
    inputSchema: z.object({
      workflowSlug: z
        .string()
        .describe(
          'Slug of the workflow containing the step(s) to update (e.g., "conversation-sync", "circuly/sync-customers"). Required.',
        ),
      stepSlug: z
        .string()
        .optional()
        .describe(
          'The step slug for single-step update. Omit when using batch mode.',
        ),
      updates: stepUpdatesSchema
        .optional()
        .describe('Fields to update for single-step mode.'),
      steps: z
        .array(
          z.object({
            stepSlug: z
              .string()
              .describe('The step slug (e.g., "fetch_customers")'),
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

      if (!isBatch && !args.stepSlug) {
        return {
          success: false,
          message:
            'Either stepSlug (single mode) or steps array (batch mode) is required.',
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
            stepSlug: s.stepSlug,
            updates: s.updates,
          }))
        : [
            {
              stepSlug: args.stepSlug ?? '',
              updates: args.updates ?? {},
            },
          ];

      // Sanitize and validate each step's updates
      const sanitizedEntries: Array<{
        stepSlug: string;
        updates: z.infer<typeof stepUpdatesSchema>;
      }> = [];

      for (const entry of stepEntries) {
        try {
          const sanitized = sanitizeUpdates(entry.updates);
          sanitizedEntries.push({
            stepSlug: entry.stepSlug,
            updates: sanitized,
          });
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          return {
            success: false,
            message: `Failed to parse tool arguments for step "${entry.stepSlug}": ${errorMsg}\n\nPlease try again with properly structured JSON.`,
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

      // Read workflow file to verify steps exist
      const readResult: { ok: boolean; config?: WorkflowJsonConfig } =
        await ctx.runAction(
          internal.workflows.file_actions.readWorkflowForExecution,
          {
            orgSlug: DEFAULT_ORG_SLUG,
            workflowSlug: args.workflowSlug,
          },
        );

      if (!readResult.ok || !readResult.config) {
        return {
          success: false,
          message: `Workflow "${args.workflowSlug}" not found. The file may have been deleted or moved.`,
          step: null,
        };
      }

      const currentConfig = readResult.config;
      const stepSlugsInFile = new Set(
        currentConfig.steps.map((s) => s.stepSlug),
      );

      // Verify all referenced steps exist in the workflow
      for (const entry of sanitizedEntries) {
        if (!stepSlugsInFile.has(entry.stepSlug)) {
          return {
            success: false,
            message: `Step "${entry.stepSlug}" not found in workflow "${args.workflowSlug}". Available steps: ${[...stepSlugsInFile].join(', ')}`,
            step: null,
          };
        }
      }

      // Get step names from the workflow file
      const stepNameMap = new Map(
        currentConfig.steps.map((s) => [s.stepSlug, s.name]),
      );

      try {
        if (isBatch) {
          // Batch mode: create single approval for all steps
          const approvalId = await ctx.runMutation(
            internal.agent_tools.workflows.internal_mutations
              .createBatchWorkflowStepUpdateApproval,
            {
              organizationId,
              workflowSlug: args.workflowSlug,
              workflowName: currentConfig.name,
              workflowVersion: currentConfig.version ?? '1.0.0',
              updateSummary: args.updateSummary,
              steps: sanitizedEntries.map((entry) => ({
                stepSlug: entry.stepSlug,
                stepName: stepNameMap.get(entry.stepSlug) ?? entry.stepSlug,
                stepUpdates: entry.updates,
              })),
              threadId,
              messageId,
            },
          );

          debugLog('batch update_workflow_step approval created', {
            stepCount: sanitizedEntries.length,
            approvalId,
          });

          const stepNames = sanitizedEntries
            .map(
              (entry) =>
                `"${stepNameMap.get(entry.stepSlug) ?? entry.stepSlug}"`,
            )
            .join(', ');

          return {
            success: true,
            requiresApproval: true,
            approvalId,
            approvalCreated: true,
            approvalMessage: `APPROVAL CREATED SUCCESSFULLY: An approval card (ID: ${approvalId}) has been created for updating ${sanitizedEntries.length} steps (${stepNames}) in workflow "${currentConfig.name}".`,
            message: `Batch step update for ${sanitizedEntries.length} steps is ready for approval. An approval card has been created.`,
          };
        } else {
          // Single step mode
          const entry = sanitizedEntries[0];
          const stepName = stepNameMap.get(entry.stepSlug) ?? entry.stepSlug;

          const approvalId = await ctx.runMutation(
            internal.agent_tools.workflows.internal_mutations
              .createWorkflowStepUpdateApproval,
            {
              organizationId,
              workflowSlug: args.workflowSlug,
              workflowName: currentConfig.name,
              workflowVersion: currentConfig.version ?? '1.0.0',
              updateSummary: args.updateSummary,
              stepSlug: entry.stepSlug,
              stepName,
              stepUpdates: entry.updates,
              threadId,
              messageId,
            },
          );

          debugLog('update_workflow_step approval created', {
            stepSlug: entry.stepSlug,
            approvalId,
          });

          return {
            success: true,
            requiresApproval: true,
            approvalId,
            approvalCreated: true,
            approvalMessage: `APPROVAL CREATED SUCCESSFULLY: An approval card (ID: ${approvalId}) has been created for updating step "${stepName}" in workflow "${currentConfig.name}". The user must approve this update before changes will be applied.`,
            message: `Step update for "${stepName}" is ready for approval. An approval card has been created. Changes will be applied once the user approves it.`,
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
