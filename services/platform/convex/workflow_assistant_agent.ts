/**
 * Workflow Assistant Agent
 *
 * Specialized AI agent for workflow creation, modification, and understanding
 */

import { action } from './_generated/server';
import { v } from 'convex/values';
import { createWorkflowAgent } from './lib/create_workflow_agent';
import { internal } from './_generated/api';
import { toonify } from '../lib/utils/toonify';
import type { ToolName } from './agent_tools/tool_registry';

export const chatWithWorkflowAssistant = action({
  args: {
    threadId: v.string(),
    organizationId: v.string(),
    workflowId: v.optional(v.id('wfDefinitions')),
    message: v.string(),
    maxSteps: v.optional(v.number()),
  },
  returns: v.object({
    response: v.string(),
    toolCalls: v.optional(
      v.array(
        v.object({
          toolName: v.string(),
          status: v.string(),
        }),
      ),
    ),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    response: string;
    toolCalls?: Array<{ toolName: string; status: string }>;
  }> => {
    const { maxSteps = 30 } = args;

    // Load workflow context if workflowId is provided
    let workflowContext = '';
    let workflow: unknown = null;
    if (args.workflowId) {
      workflow = await ctx.runQuery(internal.wf_definitions.getWorkflow, {
        wfDefinitionId: args.workflowId,
      });

      const steps = await ctx.runQuery(
        internal.wf_step_defs.listWorkflowSteps,
        {
          wfDefinitionId: args.workflowId,
        },
      );

      if (workflow && steps.length > 0) {
        const wf = workflow as {
          _id: string;
          name: string;
          description?: string;
          status: string;
        };

        // Use toonify to format the workflow data compactly
        const toonifiedSteps = toonify({
          steps: steps.map((step: unknown) => ({
            ...(step as Record<string, unknown>),
            organizationId: args.organizationId,
            wfDefinitionId: args.workflowId!,
          })),
        });

        workflowContext = `\n\n**Current Workflow Context:**
- **Workflow ID:** ${wf._id}
- **Name:** ${wf.name}
- **Description:** ${wf.description || 'No description'}
- **Status:** ${wf.status}

**Step Details (Toon Format):**
\`\`\`
${toonifiedSteps}
\`\`\``;
      }
    }

    // Check if workflow has a threadId in metadata, otherwise use the provided one
    let threadId = args.threadId;
    const wfMetadata = workflow
      ? (workflow as { metadata?: { threadId?: string } }).metadata
      : undefined;
    const existingThreadId = wfMetadata?.threadId;

    if (existingThreadId) {
      // Reuse existing threadId from workflow metadata
      threadId = existingThreadId;
      console.log(
        '[workflow_assistant] Reusing threadId from workflow metadata',
        {
          threadId,
          workflowId: args.workflowId,
        },
      );
    } else if (args.workflowId) {
      // Store the threadId in workflow metadata for future use
      await ctx.runMutation(internal.wf_definitions.updateWorkflow, {
        wfDefinitionId: args.workflowId,
        updates: {
          metadata: {
            ...(wfMetadata || {}),
            threadId: args.threadId,
          },
        },
        updatedBy: 'system',
      });
      console.log('[workflow_assistant] Stored threadId in workflow metadata', {
        threadId: args.threadId,
        workflowId: args.workflowId,
      });
    }

    // Base tool list: edit/update existing workflows and fetch context data
    const convexToolNames: ToolName[] = [
      'get_workflow_structure',
      'update_workflow_step',
      'save_workflow_definition',
      'list_available_actions',
      'search_workflow_examples',
      // Also include data tools for context
      'customer_search',
      'list_customers',
      'list_products',
      'product_get',
      'rag_search',
    ];

    // Only allow creating brand new workflows when no workflowId is present
    if (!args.workflowId) {
      convexToolNames.push('generate_workflow_from_description');
    }

    // Create specialized workflow agent with workflow tools
    const agent = await createWorkflowAgent({
      withTools: true,
      maxSteps,
      convexToolNames,
    });

    // Add organizationId and workflowId to context for tools that need them
    const contextWithOrg = {
      ...ctx,
      organizationId: args.organizationId,
      workflowId: args.workflowId,
    };

    // Enhance the message with workflow context
    const enhancedMessage = workflowContext
      ? `${args.message}${workflowContext}`
      : args.message;

    // Generate response with automatic tool handling
    // Use a real Agent thread id so context and search work correctly
    console.log('[workflow_assistant] invoking agent.generateText', {
      threadId,
      organizationId: args.organizationId,
      workflowId: args.workflowId,
      hasWorkflowContext: Boolean(workflowContext),
    });

    const result = await agent.generateText(
      contextWithOrg,
      { threadId },
      {
        prompt: enhancedMessage,
      },
    );

    console.log('[workflow_assistant] agent result', {
      text: (result as { text?: string }).text,
      // steps may be large; we only log high-level info
      stepsSummary: ((result as { steps?: unknown[] })?.steps || []).map(
        (step: unknown, index: number) => {
          const s = step as {
            type?: string;
            toolName?: string;
            result?: { success?: boolean };
          };
          return {
            index,
            type: s.type,
            toolName: s.toolName,
            success: s.result?.success,
          };
        },
      ),
    });

    // Extract tool call information if available
    const steps = (result as { steps?: unknown[] })?.steps || [];
    const toolCalls = steps
      .filter((step: unknown) => {
        const s = step as { type?: string };
        return s.type === 'tool-call';
      })
      .map((step: unknown) => {
        const s = step as {
          toolName?: string;
          result?: { success?: boolean };
        };
        return {
          toolName: s.toolName || 'unknown',
          status: s.result?.success ? 'completed' : 'failed',
        };
      });

    const responseText = (result as { text?: string }).text || '';

    return {
      response: responseText,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  },
});
