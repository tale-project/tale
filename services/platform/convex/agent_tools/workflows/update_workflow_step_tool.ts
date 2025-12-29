/**
 * Convex Tool: Update Workflow Step
 *
 * Updates an existing workflow step with built-in validation.
 * Validates step configuration before saving.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';
import type { Doc, Id } from '../../_generated/dataModel';
import { internal } from '../../_generated/api';
import {
  validateStepConfig,
  isValidStepType,
} from '../../workflow/helpers/validation/validate_step_config';

import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

export const updateWorkflowStepTool = {
  name: 'update_workflow_step' as const,
  tool: createTool({
    description: `Update an existing workflow step. Use this to modify step configuration, name, or connections.

**CRITICAL JSON FORMATTING RULES:**
1. When passing long strings (especially prompts), ensure proper JSON escaping of special characters
2. Escape all double quotes inside strings with backslash: \\"
3. Escape all backslashes: \\\\
4. Escape newlines as \\n, not literal line breaks
5. Test your JSON structure is valid before calling this tool

**CRITICAL STRUCTURE RULES:**
1. 'config' and 'nextSteps' are SEPARATE fields in the 'updates' object - NEVER nest nextSteps inside config!
2. For ACTION steps, 'config' MUST include the 'type' field (e.g., "customer", "product")

**CORRECT structure:**
{
  stepRecordId: "...",
  updates: {
    config: { type: "customer", parameters: {...} },  // config contains step-specific settings
    nextSteps: { success: "next_step_slug" }          // nextSteps is SEPARATE, at same level as config
  }
}

**WRONG structure (will cause validation error):**
{
  stepRecordId: "...",
  updates: {
    config: {
      parameters: {...},
      nextSteps: { success: "..." }  // WRONG! nextSteps should NOT be inside config!
    }
  }
}

**Examples of updating config:**

1. **Update trigger schedule:**
   {
     stepRecordId: "...",
     updates: {
       config: { schedule: "0 */4 * * *", timezone: "UTC", type: "scheduled" }
     }
   }

2. **Update LLM prompt:**
   {
     stepRecordId: "...",
     updates: {
       config: { name: "Analyze Customer", systemPrompt: "...", userPrompt: "..." }
     }
   }

3. **Update action parameters (MUST include 'type'):**
   {
     stepRecordId: "...",
     updates: {
       config: { type: "customer", parameters: { operation: "update", ... } },
       nextSteps: { success: "next_step" }
     }
   }

**IMPORTANT RULES:**
- **CRITICAL: You MUST first call workflow_read with operation='get_step' to get the current step details**
- When updating config, you MUST pass the COMPLETE config object with ALL required fields from the current step
- When updating config, you SHOULD include the stepType in updates.stepType (get it from the current step via get_step)
- For ACTION steps: config MUST have 'type' field (action type like "customer", "product")
- nextSteps goes at updates.nextSteps, NOT inside updates.config

**REQUIRED WORKFLOW:**
1. Call workflow_read(operation='get_step', stepId='<step_id>') to get current step
2. Extract step.stepType and step.config from result
3. Modify only the fields you need to change in config
4. Call update_workflow_step with stepType and complete modified config`,
    args: z.object({
      stepRecordId: z
        .string()
        .describe('The step record ID (Convex Id<"wfStepDefs">)'),
      updates: z
        .object({
          name: z.string().optional().describe('New step name'),
          stepType: z
            .enum(['trigger', 'llm', 'action', 'condition', 'loop'])
            .optional()
            .describe(
              'New step type. Options: trigger (starts workflow - scheduled/manual/event), llm (AI agent with tools), action (database/API operations), condition (branching logic), loop (iterate over collections)',
            ),
          order: z.number().optional().describe('New order number'),
          config: z
            .any()
            .optional()
            .describe(
              `Updated configuration object. Must include ALL required fields for the step type.

Examples by step type:

TRIGGER (scheduled):
{ schedule: "0 */4 * * *", timezone: "UTC", type: "scheduled" }
- schedule: cron expression (e.g., "0 */4 * * *" = every 4 hours at minute 0)
- timezone: IANA timezone (e.g., "UTC", "America/New_York")
- type: "scheduled" for cron-based triggers

TRIGGER (manual):
{ type: "manual" }
- type: "manual" for on-demand triggers

LLM (AI agent):
{ name: "Analyze Customer", systemPrompt: "You are a customer analyst...", userPrompt: "Analyze this customer data", temperature: 0.7, tools: ["product_get", "customer_get"] }
- name: human-readable name for this LLM step (REQUIRED)
- systemPrompt: system instructions/role definition for the AI agent (REQUIRED, not "prompt")
- userPrompt: specific task prompt for this execution (OPTIONAL but recommended - separates role from task)
- temperature: creativity level (0.0-1.0) (optional)
- tools: array of tool names the agent can use (optional)
- outputFormat: "text" or "json" (optional)
- maxSteps: maximum tool calling iterations (optional)
- Model selection: The model is configured globally via the OPENAI_MODEL environment variable (required; no default) and cannot be customized per step. Do NOT include a 'model' field in the step config.

ACTION (registered action):
{ type: "customer", parameters: { operation: "search", query: "{{steps.previous_step.output}}", limit: 10 } }
- type: the action type (e.g., "customer", "product", "conversation", "shopify")
- parameters: input parameters (can use {{steps.stepSlug.field}} for dynamic values)
  - For most actions, include "operation" to specify the operation (e.g., "search", "get_by_id", "create", "update")

CONDITION (branching):
{ expression: "{{steps.previous_step.count}} > 10" }
- expression: JEXL expression that evaluates to boolean
- Use {{steps.stepSlug.field}} to reference previous step outputs

LOOP (iteration):
{ items: "{{steps.previous_step.customers}}", itemVariable: "customer" }
- items: array to iterate over (can use {{steps.stepSlug.field}})
- itemVariable: name to reference current item in loop body`,
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
        const repairObject = (obj: any): any => {
          if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
            return obj;
          }

          const repaired: Record<string, any> = {};
          for (const [key, value] of Object.entries(obj)) {
            let repairedKey = key;

            // If key contains newlines or is too descriptive, try to extract the actual field name
            if (/[\x00-\x1F\x7F]/.test(key) || key.length > 50) {
              // Try to extract common field names from descriptive keys
              const fieldNameMatch = key.match(/^(config|userPrompt|systemPrompt|name|parameters|type|nextSteps|order|stepType)/i);
              if (fieldNameMatch) {
                repairedKey = fieldNameMatch[1];
                debugLog('Repaired field name', { original: key.substring(0, 50), repaired: repairedKey });
              } else {
                // Can't repair this key, leave it as-is for validation to catch
                repairedKey = key;
              }
            }

            repaired[repairedKey] = typeof value === 'object' && value !== null ? repairObject(value) : value;
          }
          return repaired;
        };

        sanitizedUpdates = repairObject(sanitizedUpdates);

        // Additional validation: check for extremely long field names and invalid characters
        const validateObject = (obj: any, path = ''): void => {
          if (!obj || typeof obj !== 'object') return;

          for (const [key, value] of Object.entries(obj)) {
            // Check for control characters (including newlines, tabs, etc.)
            // Control characters are ASCII 0-31 and 127
            const hasControlChars = /[\x00-\x1F\x7F]/.test(key);
            if (hasControlChars) {
              // Show escaped version to make control chars visible
              const escapedKey = JSON.stringify(key).slice(1, -1);
              throw new Error(
                `Invalid field name contains control characters: "${escapedKey.substring(0, 50)}${escapedKey.length > 50 ? '...' : ''}". Field names cannot contain newlines, tabs, or other control characters. This indicates malformed JSON from the LLM.`
              );
            }

            // Field names should never exceed 100 characters in normal usage
            if (key.length > 100) {
              throw new Error(
                `Invalid field name detected (length: ${key.length}). This usually indicates malformed JSON from the LLM. Field path: ${path}.${key.substring(0, 50)}...`
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
        debugLog('JSON sanitization failed', { error: errorMsg, originalUpdates: args.updates });

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

      // Validate step config if it's being updated
      // Note: When only config is updated without stepType, validation may be incomplete
      // since we don't fetch the existing step's stepType. The mutation itself will
      // handle the full validation with the merged step data.
      if (sanitizedUpdates.config || sanitizedUpdates.stepType) {
        const stepValidation = validateStepConfig({
          stepSlug: 'update', // Placeholder, actual slug comes from existing step
          name: sanitizedUpdates.name ?? 'Step',
          stepType: sanitizedUpdates.stepType, // May be undefined if only config is being updated
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
        const config = sanitizedUpdates.config as
          | Record<string, unknown>
          | undefined;
        if (
          sanitizedUpdates.stepType === 'action' &&
          config &&
          typeof config === 'object' &&
          'type' in config
        ) {
          const actionType = config.type as string;
          if (isValidStepType(actionType)) {
            warnings.push(
              `Action type "${actionType}" matches a stepType name. Did you mean stepType: "${actionType}"?`
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

      const updatedStep = (await ctx.runMutation(
        internal.wf_step_defs.updateStep,
        {
          stepRecordId: args.stepRecordId as Id<'wfStepDefs'>,
          updates: sanitizedUpdates as any,
        },
      )) as Doc<'wfStepDefs'> | null;

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
