/**
 * Convex Tool: Generate Workflow from Description
 *
 * Uses AI to generate a complete workflow structure from natural language
 */

'use node';

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolDefinition } from '../../types';
import { generateObject } from 'ai';
import { openai } from '../../../lib/openai_provider';
import { internal } from '../../../_generated/api';

// Schema for workflow generation
const workflowSchema = z.object({
  workflowConfig: z.object({
    name: z.string(),
    description: z.string(),
  }),
  stepsConfig: z.array(
    z.object({
      stepSlug: z.string(),
      name: z.string(),
      stepType: z.enum(['trigger', 'llm', 'action', 'condition', 'loop']),
      order: z.number(),
      config: z.record(z.string(), z.unknown()),
      nextSteps: z.record(z.string(), z.string()),
    }),
  ),
});

export const generateWorkflowFromDescriptionTool = {
  name: 'generate_workflow_from_description' as const,
  tool: createTool({
    description:
      'Generate a complete workflow structure from a natural language description. IMPORTANT: Before using this tool, ALWAYS call search_workflow_examples first to find similar workflows and learn the correct config structure. Use this tool only after studying real examples, and only when there is NO workflowId in context (i.e., when creating a brand new automation). When attached to an existing automation (workflowId present), you MUST NOT use this tool and must instead update that workflow using save_workflow_definition and/or update_workflow_step.',
    args: z.object({
      description: z
        .string()
        .describe(
          'Natural language description of what the workflow should do',
        ),
    }),
    handler: async (
      ctx,
      args,
    ): Promise<{
      success: boolean;
      workflowId?: string;
      workflow?: unknown;
      message: string;
    }> => {
      const organizationId = (ctx as unknown as { organizationId?: string })
        .organizationId;

      if (!organizationId) {
        throw new Error('organizationId is required in context');
      }

      try {
        // Use AI to generate structured workflow
        const envModel = (process.env.OPENAI_MODEL || '').trim();
        if (!envModel) {
          throw new Error(
            'OPENAI_MODEL environment variable is required for workflow generation but is not set',
          );
        }

        const { object: workflow } = await generateObject({
          model: openai(envModel),
          schema: workflowSchema,
          prompt: `Generate a workflow automation based on this description:

"${args.description}"

**CRITICAL: Determine Workflow Type First**

	**Entity Processing Workflows** (process ONE entity per execution):
	- Customer analysis, product recommendations, conversation replies, status assessments
	- MUST use this structure:
	  1. Scheduled trigger (e.g., {type: "scheduled", schedule: "0 */2 * * *", timezone: "UTC"})
  2. workflow_processing_records action with operation: "find_unprocessed"
  3. Condition checking if entity found (count > 0)
  4-N. Your business logic steps
  N+1. workflow_processing_records action with operation: "record_processed"

**Data Sync Workflows** (process multiple items per execution):
- Shopify sync, IMAP sync, website crawling
- Can use manual or scheduled triggers
- Use pagination patterns with loops

Requirements:
1. Start with a trigger step (stepSlug: "start", order: 1)
2. For entity processing, use scheduled trigger and workflow_processing_records pattern
3. Use appropriate step types for each operation
4. **CRITICAL: For complex business logic, ALWAYS use LLM steps instead of action steps**
   - LLM steps can analyze data, make decisions, generate content, and handle complex reasoning
   - Action steps should ONLY be used for simple CRUD operations (query, insert, update, delete)
   - Examples requiring LLM steps:
     * Analyzing customer behavior and generating insights
     * Creating personalized email content based on customer data
     * Deciding which products to recommend based on purchase history
     * Evaluating whether a customer needs attention based on multiple factors
     * Generating summaries or reports from data
   - Examples using action steps:
     * Fetching a customer record by ID
     * Inserting a new approval record
     * Updating a conversation status
     * Querying for unprocessed entities
5. For branching logic, use "condition" steps (simple boolean checks only)
6. Connect steps using nextSteps (e.g., {success: "next_step_slug"})
7. Use descriptive names and stepSlugs (snake_case)
8. Use 'noop' in nextSteps to end workflow gracefully

		Available tools for LLM steps:
		- customer_search, list_customers, update_customer
		- product_get, list_products, update_product
		- find_unprocessed_entities, mark_entity_processed
		- rag_search
		
		**CRITICAL: Valid Step Types (ONLY these 5):**
			stepType must be one of: "trigger", "llm", "action", "condition", "loop"
			
			Step type configurations:
			- trigger: {type: "manual" | "scheduled", schedule?: "0 */2 * * *", timezone?: "UTC"}
			- llm: {name: "Step Name" (REQUIRED), systemPrompt: "You are a..." (REQUIRED - role/instructions), userPrompt: "Analyze this..." (OPTIONAL but recommended - specific task), tools?: [], temperature?: 0.7, maxTokens?: 2000, maxSteps?: 10, outputFormat?: "text" | "json"}
			  - Model selection: The model is configured globally via the OPENAI_MODEL environment variable (required; no default) and must NOT be set per step.
			- action: {type: "action_type" (REQUIRED), parameters: {operation: "operation_name", ...other params}}
		  * IMPORTANT: "approval", "customer", "product", "workflow_processing_records", etc. are NOT stepTypes - they are action types used in config.type
		- condition: {expression: "{{variable}} > 10"}
		- loop: {items: "{{steps.previous.items}}", itemVariable: "item"}
		
		Common action types (these go in config.type for action steps):
		- workflow_processing_records: find_unprocessed, record_processed
		- customer: create, query, filter, update
		- product: create, query, filter, update, hydrate_fields
		- conversation: query_messages, create_from_email, update
		- approval: create_approval (stepType: "action", config.type: "approval")
		- set_variables: Set workflow variables
		
		Example trigger step structure:
		{
		  stepSlug: "start",
		  name: "Run every 2 hours",
		  stepType: "trigger",
		  order: 1,
		  config: {
		    type: "scheduled",
		    schedule: "0 */2 * * *",
		    timezone: "UTC"
		  },
		  nextSteps: { success: "find_unprocessed" }
		}
		
		Example action step structure:
{
  stepSlug: "create_approval",
  name: "Create Approval",
  stepType: "action",  // <-- stepType is "action"
  order: 5,
  config: {
    type: "approval",  // <-- action type is "approval"
    parameters: {
      operation: "create_approval",
      organizationId: "{{organizationId}}",
      resourceType: "email",
      resourceId: "{{customerId}}",
      priority: "high",
      description: "Review email",
      metadata: {}
    }
  },
  nextSteps: { success: "record_processed" }
}

Templating:
- Variables: {{variableName}}, {{organizationId}}, {{workflowId}}
- Step outputs: {{steps.stepSlug.output.data.property}}
- Secrets: {{secrets.secretName}}
- Loop: {{loop.item}}
- Filters: {{items|map("id")}}, {{items|length}}, {{array1|hasOverlap(array2)}}

		Generate a complete, working workflow now.`,
        });

        // Save the workflow to database (creation only)
        const result = await ctx.runMutation(
          internal.wf_definitions.createWorkflowWithSteps,
          {
            organizationId,
            workflowConfig: {
              ...workflow.workflowConfig,
              workflowType: 'predefined',
              config: {
                ...(workflow.workflowConfig as any).config,
                // Ensure variables object exists so the engine can reference organizationId
                variables: {
                  ...(workflow.workflowConfig as any).config?.variables,
                  organizationId,
                },
              },
            },
            stepsConfig: workflow.stepsConfig,
          },
        );

        return {
          success: true,
          workflowId: result.workflowId as string,
          workflow: workflow,
          message: `Successfully created workflow "${workflow.workflowConfig.name}" with ${workflow.stepsConfig.length} steps`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to generate workflow: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
      }
    },
  }),
} as const satisfies ToolDefinition;
