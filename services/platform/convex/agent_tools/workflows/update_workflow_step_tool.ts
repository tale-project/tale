/**
 * Convex Tool: Update Workflow Step
 *
 * Updates an existing workflow step with built-in validation.
 * Validates step configuration before saving.
 */

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { Doc } from '../../_generated/dataModel';
import type { ToolDefinition } from '../types';

import { isRecord } from '../../../lib/utils/type-guards';
import { internal } from '../../_generated/api';
import { createDebugLog } from '../../lib/debug_log';
import { toId } from '../../lib/type_cast_helpers';
import {
  validateStepConfig,
  isValidStepType,
} from '../../workflow_engine/helpers/validation/validate_step_config';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

export const updateWorkflowStepTool = {
  name: 'update_workflow_step' as const,
  tool: createTool({
    description: `Update an existing workflow step configuration.

**REQUIRED STEPS:**
1. Call workflow_read(operation='get_step', stepId='...') to get current config
2. Modify config based on current values (keep ALL required fields)
3. Call this tool with stepRecordId and updates

**CRITICAL RULES:**
• nextSteps goes in updates.nextSteps, NOT inside updates.config
• For action steps: config MUST include 'type' field
• Include stepType in updates when updating config

**STRUCTURE:**
{ stepRecordId: "...", updates: { stepType: "...", config: {...}, nextSteps: {...} } }

**JSON RULES:**
• Escape quotes: \\" | Escape backslashes: \\\\ | Newlines: \\n

**SYNTAX HELP:**
workflow_examples(operation='get_syntax_reference', category='start|llm|action|condition|loop')`,
    args: z.object({
      stepRecordId: z
        .string()
        .describe('The step record ID (Convex Id<"wfStepDefs">)'),
      updates: z
        .object({
          name: z.string().optional().describe('New step name'),
          stepType: z
            .enum(['start', 'llm', 'action', 'condition', 'loop'])
            .optional()
            .describe(
              'New step type. Options: start (workflow entry point, optional inputSchema), llm (AI agent with tools), action (database/API operations), condition (branching logic), loop (iterate over collections)',
            ),
          order: z.number().optional().describe('New order number'),
          config: z
            .any()
            .optional()
            .describe(
              'Updated config object. Must include ALL required fields for the step type. For LLM: name + systemPrompt. For action: type + parameters. Use workflow_examples(get_syntax_reference) for detailed syntax.',
            ),
          nextSteps: z
            .any()
            .optional()
            .describe(
              'Updated next step connections. IMPORTANT: This is a TOP-LEVEL field in updates, NOT inside config! Keys are outcomes (e.g., "success", "failure", "true", "false"), values are stepSlugs to execute next. Example: { success: "send_email", failure: "log_error" }',
            ),
        })
        .describe('Fields to update'),
    }),
    handler: async (
      ctx,
      args,
    ): Promise<{
      success: boolean;
      message: string;
      step: Doc<'wfStepDefs'> | null;
      validationErrors?: string[];
      validationWarnings?: string[];
    }> => {
      debugLog('update_workflow_step tool called', {
        stepRecordId: args.stepRecordId,
        updates: args.updates,
      });

      // Sanitize args.updates to prevent malformed JSON structures
      // This handles cases where LLM generates corrupted JSON with field values merged into field names
      let sanitizedUpdates = args.updates;
      try {
        // Deep clone and re-parse to ensure clean JSON structure
        const jsonStr = JSON.stringify(args.updates);
        sanitizedUpdates = JSON.parse(jsonStr);

        // Attempt to repair common corruption patterns
        // Pattern: Field names that look like descriptions instead of identifiers
        // Generic preserves input type — structural shape is maintained by key repair
        const repairObject = <T>(obj: T): T => {
          if (!obj || typeof obj !== 'object') {
            return obj;
          }

          // Handle arrays by recursively repairing each element
          if (Array.isArray(obj)) {
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- generic return, array structure preserved
            return obj.map((item) => repairObject(item)) as unknown as T;
          }

          const repaired: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- generic object iteration
            obj as Record<string, unknown>,
          )) {
            let repairedKey = key;

            // If key contains newlines or is too descriptive, try to extract the actual field name
            // biome-ignore lint/suspicious/noControlCharactersInRegex: Intentionally matching control characters to detect and repair corrupted field names
            if (/[\x00-\x1F\x7F]/.test(key) || key.length > 50) {
              // Try to extract common field names from descriptive keys
              const fieldNameMatch = key.match(
                /^(config|userPrompt|systemPrompt|name|parameters|type|nextSteps|order|stepType)/i,
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
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- generic return, object structure preserved
          return repaired as unknown as T;
        };

        sanitizedUpdates = repairObject(sanitizedUpdates);

        // Additional validation: check for extremely long field names and invalid characters
        const validateObject = (obj: unknown, path = ''): void => {
          if (!obj || typeof obj !== 'object') return;

          // Handle arrays by recursively validating each element
          if (Array.isArray(obj)) {
            obj.forEach((item, index) =>
              validateObject(item, `${path}[${index}]`),
            );
            return;
          }

          for (const [key, value] of Object.entries(obj)) {
            // Check for control characters (including newlines, tabs, etc.)
            // Control characters are ASCII 0-31 and 127
            // biome-ignore lint/suspicious/noControlCharactersInRegex: Intentionally matching control characters to reject them
            const hasControlChars = /[\x00-\x1F\x7F]/.test(key);
            if (hasControlChars) {
              // Show escaped version to make control chars visible
              const escapedKey = JSON.stringify(key).slice(1, -1);
              throw new Error(
                `Invalid field name contains control characters: "${escapedKey.slice(0, 50)}${escapedKey.length > 50 ? '...' : ''}". Field names cannot contain newlines, tabs, or other control characters. This indicates malformed JSON from the LLM.`,
              );
            }

            // Field names should never exceed 100 characters in normal usage
            if (key.length > 100) {
              throw new Error(
                `Invalid field name detected (length: ${key.length}). This usually indicates malformed JSON from the LLM. Field path: ${path}.${key.slice(0, 50)}...`,
              );
            }

            // Recursively validate nested objects
            if (typeof value === 'object' && value !== null) {
              validateObject(value, path ? `${path}.${key}` : key);
            }
          }
        };

        validateObject(sanitizedUpdates);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        debugLog('JSON sanitization failed', {
          error: errorMsg,
          originalUpdates: args.updates,
        });

        return {
          success: false,
          message: `Failed to parse tool arguments: ${errorMsg}

IMPORTANT: This error means the tool call JSON is malformed. Common causes:
1. Field names with newlines or special characters (field names should be simple identifiers like "config", "userPrompt", etc.)
2. Missing quotes around string values
3. Unescaped special characters in string values

Please try again with a properly structured JSON object. Ensure all field names are simple identifiers without spaces or special characters.`,
          step: null,
          validationErrors: [errorMsg],
        };
      }

      // Validate step config if both stepType and config are available.
      // When only config is updated without stepType, we skip client-side validation
      // since validateStepConfig requires stepType. The mutation itself validates
      // the merged step data with the existing stepType from the database.
      if (sanitizedUpdates.stepType && sanitizedUpdates.config) {
        const stepValidation = validateStepConfig({
          stepSlug: 'update', // Placeholder, actual slug comes from existing step
          name: sanitizedUpdates.name ?? 'Step',
          stepType: sanitizedUpdates.stepType,
          config: sanitizedUpdates.config,
        });

        const errors: string[] = [];
        const warnings: string[] = [];

        if (!stepValidation.valid) {
          errors.push(...stepValidation.errors);
        }
        if (stepValidation.warnings) {
          warnings.push(...stepValidation.warnings);
        }

        // Additional warning for action type matching stepType
        const config = isRecord(sanitizedUpdates.config)
          ? sanitizedUpdates.config
          : undefined;
        if (
          sanitizedUpdates.stepType === 'action' &&
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

        if (errors.length > 0) {
          return {
            success: false,
            message: `Step validation failed with ${errors.length} error(s). Fix the errors and try again.`,
            step: null,
            validationErrors: errors,
            validationWarnings: warnings.length > 0 ? warnings : undefined,
          };
        }
      }

      // stepRecordId comes from LLM, cast to expected ID type
      const updatedStep = await ctx.runMutation(
        internal.wf_step_defs.internal_mutations.patchStep,
        {
          stepRecordId: toId<'wfStepDefs'>(args.stepRecordId),
          updates: sanitizedUpdates,
        },
      );

      debugLog('update_workflow_step tool success', {
        stepRecordId: args.stepRecordId,
        updatedStep,
      });

      return {
        success: true,
        message: `Successfully updated step`,
        step: updatedStep,
      };
    },
  }),
} as const satisfies ToolDefinition;
