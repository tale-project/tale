/**
 * Convex Tool: Update Workflow Step
 *
 * Updates an existing workflow step
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolDefinition } from '../../types';
import type { Doc, Id } from '../../../_generated/dataModel';
import { internal } from '../../../_generated/api';

import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

export const updateWorkflowStepTool = {
  name: 'update_workflow_step' as const,
  tool: createTool({
    description: `Update an existing workflow step. Use this to modify step configuration, name, or connections.

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
- When updating config, you MUST pass the COMPLETE config object with ALL required fields
- For ACTION steps: config MUST have 'type' field (action type like "customer", "product")
- nextSteps goes at updates.nextSteps, NOT inside updates.config
- Use get_workflow_structure to see current config before updating`,
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
    }> => {
      debugLog('update_workflow_step tool called', {
        stepRecordId: args.stepRecordId,
        updates: args.updates,
      });

      const updatedStep = (await ctx.runMutation(
        internal.wf_step_defs.updateStep,
        {
          stepRecordId: args.stepRecordId as Id<'wfStepDefs'>,
          updates: args.updates as any,
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
