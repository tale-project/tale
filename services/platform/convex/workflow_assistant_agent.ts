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
import {
  type FileAttachment,
  registerFilesWithAgent,
  buildMultiModalContent,
  type MessageContentPart,
} from './lib/attachments/index';

import { createDebugLog } from './lib/debug_log';

const debugLog = createDebugLog('DEBUG_WORKFLOW_AGENT', '[WorkflowAgent]');

export const chatWithWorkflowAssistant = action({
  args: {
    threadId: v.string(),
    organizationId: v.string(),
    workflowId: v.optional(v.id('wfDefinitions')),
    message: v.string(),
    maxSteps: v.optional(v.number()),
    attachments: v.optional(
      v.array(
        v.object({
          fileId: v.id('_storage'),
          fileName: v.string(),
          fileType: v.string(),
          fileSize: v.number(),
        }),
      ),
    ),
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

      if (workflow) {
        const wf = workflow as {
          _id: string;
          name: string;
          description?: string;
          status: string;
        };

        // Build workflow context - always include basic info
        workflowContext = `\n\n**Current Workflow Context:**
- **Workflow ID:** ${wf._id}
- **Name:** ${wf.name}
- **Description:** ${wf.description || 'No description'}
- **Status:** ${wf.status}`;

        // Add step details if there are steps
        if (steps.length > 0) {
          const toonifiedSteps = toonify({
            steps: steps.map((step: unknown) => ({
              ...(step as Record<string, unknown>),
              organizationId: args.organizationId,
              wfDefinitionId: args.workflowId!,
            })),
          });
          workflowContext += `

**Step Details (Toon Format):**
\`\`\`
${toonifiedSteps}
\`\`\``;
        } else {
          workflowContext += `

**Steps:** No steps yet. Create steps for this workflow.`;
        }
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
      debugLog('Reusing threadId from workflow metadata', {
        threadId,
        workflowId: args.workflowId,
      });
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
      debugLog('Stored threadId in workflow metadata', {
        threadId: args.threadId,
        workflowId: args.workflowId,
      });
    }

    // Base tool list: edit/update existing workflows and fetch context data
    const convexToolNames: ToolName[] = [
      'workflow_read',
      'workflow_examples', // Access predefined workflow templates
      'update_workflow_step',
      'save_workflow_definition',
      // Also include data tools for context
      'customer_read',
      'product_read',
    ];

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

    // Process attachments if provided
    const attachments = args.attachments as FileAttachment[] | undefined;
    let promptContent:
      | Array<{ role: 'user'; content: MessageContentPart[] }>
      | undefined;

    if (attachments && attachments.length > 0) {
      debugLog('Processing file attachments', {
        count: attachments.length,
        files: attachments.map((a) => ({ name: a.fileName, type: a.fileType })),
      });

      // Register files with the agent component for proper tracking
      const registeredFiles = await registerFilesWithAgent(ctx, attachments);

      if (registeredFiles.length > 0) {
        // Build multi-modal content with the enhanced message
        const { contentParts } = buildMultiModalContent(
          registeredFiles,
          enhancedMessage,
        );

        promptContent = [
          {
            role: 'user',
            content: contentParts,
          },
        ];
      }
    }

    // Generate response with automatic tool handling
    // Use a real Agent thread id so context and search work correctly
    debugLog('invoking agent.generateText', {
      threadId,
      organizationId: args.organizationId,
      workflowId: args.workflowId,
      hasWorkflowContext: Boolean(workflowContext),
      hasAttachments: Boolean(promptContent),
    });

    const result = await agent.generateText(
      contextWithOrg,
      { threadId },
      // If we have attachments, use prompt array for multi-modal content
      // Otherwise, use the simple string prompt
      promptContent
        ? { prompt: promptContent }
        : { prompt: enhancedMessage },
    );

    debugLog('agent result', {
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
