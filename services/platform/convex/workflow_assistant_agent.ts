/**
 * Workflow Assistant Agent
 *
 * Specialized AI agent for workflow creation, modification, and understanding
 */

import { action } from './_generated/server';
import { v } from 'convex/values';
import { createWorkflowAgent } from './lib/create_workflow_agent';
import { components, internal } from './_generated/api';
import { toonify } from '../lib/utils/toonify';
import type { ToolName } from './agent_tools/tool_registry';
import {
  type FileAttachment,
  type MessageContentPart,
} from './lib/attachments/index';
import { saveMessage } from '@convex-dev/agent';
import { parseFile } from './agent_tools/files/helpers/parse_file';
import { analyzeImage } from './agent_tools/files/helpers/analyze_image';

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
    // Pass workflow context to be included in the system prompt
    const agent = createWorkflowAgent({
      withTools: true,
      maxSteps,
      convexToolNames,
      workflowContext: workflowContext || undefined,
    });

    // Add organizationId and workflowId to context for tools that need them
    const contextWithOrg = {
      ...ctx,
      organizationId: args.organizationId,
      workflowId: args.workflowId,
    };

    // Process attachments if provided
    const attachments = args.attachments as FileAttachment[] | undefined;
    let promptContent:
      | Array<{ role: 'user'; content: MessageContentPart[] }>
      | undefined;
    let promptMessageId: string | undefined;

    // Build message content for saving and AI prompting
    // Note: We only save text parts, not image parts, to avoid breaking non-vision models
    type ContentPart = { type: 'text'; text: string };

    if (attachments && attachments.length > 0) {
      debugLog('Processing file attachments', {
        count: attachments.length,
        files: attachments.map((a) => ({ name: a.fileName, type: a.fileType })),
      });

      // Separate images from other files
      const imageAttachments = attachments.filter((a) =>
        a.fileType.startsWith('image/'),
      );
      const documentAttachments = attachments.filter(
        (a) => !a.fileType.startsWith('image/'),
      );

      // Build content parts for saving the message (with image URLs for display)
      // NOTE: We save the CLEAN user message (without workflow context) for display
      // The workflow context is passed to the AI via the prompt, not stored in the message
      const saveContentParts: ContentPart[] = [];
      let displayTextContent = args.message; // Use original message, not enhancedMessage

      // Parse document files and extract their text content
      const parsedDocuments: Array<{
        fileName: string;
        content: string;
        url: string;
      }> = [];

      // Add document references as markdown to the text (for display)
      // Process documents in parallel for better performance
      if (documentAttachments.length > 0) {
        const docResults = await Promise.all(
          documentAttachments.map(async (attachment) => {
            try {
              const url = await ctx.storage.getUrl(attachment.fileId);
              if (!url) return null;

              const sizeKB = Math.round(attachment.fileSize / 1024);
              const sizeDisplay =
                sizeKB >= 1024
                  ? `${(sizeKB / 1024).toFixed(1)} MB`
                  : `${sizeKB} KB`;
              const markdown = `📎 [${attachment.fileName}](${url}) (${attachment.fileType}, ${sizeDisplay})`;

              // Parse document to extract text content for AI
              const parseResult = await parseFile(
                url,
                attachment.fileName,
                'workflow_assistant',
              );

              return { attachment, url, markdown, parseResult };
            } catch (error) {
              debugLog('Error processing document', {
                fileName: attachment.fileName,
                error: String(error),
              });
              return null;
            }
          }),
        );

        const docMarkdown: string[] = [];
        for (const result of docResults) {
          if (!result) continue;

          docMarkdown.push(result.markdown);

          if (result.parseResult.success && result.parseResult.full_text) {
            parsedDocuments.push({
              fileName: result.attachment.fileName,
              content: result.parseResult.full_text,
              url: result.url,
            });
            debugLog('Parsed document', {
              fileName: result.attachment.fileName,
              textLength: result.parseResult.full_text.length,
            });
          } else {
            debugLog('Failed to parse document', {
              fileName: result.attachment.fileName,
              error: result.parseResult.error,
            });
          }
        }

        if (docMarkdown.length > 0) {
          // For display: user message + document links (no workflow context)
          displayTextContent = `${args.message}\n\n${docMarkdown.join('\n')}`;
        }
      }

      // Add image references as text (NOT multi-modal image parts)
      // We do NOT save image parts inline because:
      // 1. The main agent model may not support images
      // 2. When loading thread history for follow-up messages, old image parts would
      //    be sent to the model, causing "No endpoints found that support image input"
      // 3. Images are analyzed separately using the vision model below
      if (imageAttachments.length > 0) {
        const imageUrls = await Promise.all(
          imageAttachments.map(async (attachment) => ({
            attachment,
            url: await ctx.storage.getUrl(attachment.fileId),
          })),
        );

        // Use the same format as documents - regular links, not markdown image syntax
        // The UI doesn't render markdown well, so we avoid ![...](...)
        const imageLinks: string[] = [];
        for (const { attachment, url } of imageUrls) {
          if (url) {
            const sizeKB = Math.round(attachment.fileSize / 1024);
            const sizeDisplay =
              sizeKB >= 1024
                ? `${(sizeKB / 1024).toFixed(1)} MB`
                : `${sizeKB} KB`;
            imageLinks.push(
              `🖼️ [${attachment.fileName}](${url}) (${attachment.fileType}, ${sizeDisplay})`,
            );
          }
        }

        if (imageLinks.length > 0) {
          displayTextContent = displayTextContent
            ? `${displayTextContent}\n\n${imageLinks.join('\n')}`
            : imageLinks.join('\n');
        }
      }

      saveContentParts.push({ type: 'text', text: displayTextContent });

      // Save the user message with text-only content for display
      // Images are analyzed separately and their analysis is included in the AI prompt
      if (imageAttachments.length > 0 || documentAttachments.length > 0) {
        const { messageId } = await saveMessage(ctx, components.agent, {
          threadId,
          message: { role: 'user', content: saveContentParts },
        });
        promptMessageId = messageId;
      }

      // Analyze images using the vision model and extract content as text
      // This ensures the workflow agent (which may not be a vision model) can understand images
      const analyzedImages: Array<{
        fileName: string;
        analysis: string;
      }> = [];

      if (imageAttachments.length > 0) {
        debugLog('Analyzing images with vision model', {
          count: imageAttachments.length,
        });

        const imageAnalysisResults = await Promise.all(
          imageAttachments.map(async (attachment) => {
            try {
              const result = await analyzeImage(ctx, {
                fileId: attachment.fileId,
                question:
                  'Extract and describe all content from this image in detail. Include all visible text, data, and information.',
                fileName: attachment.fileName,
              });

              if (result.success && result.analysis) {
                return {
                  fileName: attachment.fileName,
                  analysis: result.analysis,
                };
              }
              debugLog('Image analysis failed', {
                fileName: attachment.fileName,
                error: result.error,
              });
              return null;
            } catch (error) {
              debugLog('Error analyzing image', {
                fileName: attachment.fileName,
                error: String(error),
              });
              return null;
            }
          }),
        );

        for (const result of imageAnalysisResults) {
          if (result) {
            analyzedImages.push(result);
          }
        }
      }

      // Build prompt content for AI
      // For images: include analyzed text content (extracted by vision model)
      // For documents: include parsed text content
      if (analyzedImages.length > 0 || parsedDocuments.length > 0) {
        // Start with the user's original message (workflow context is passed via contextMessages)
        const aiContentParts: MessageContentPart[] = [
          { type: 'text', text: args.message },
        ];

        // Add parsed document content for the AI to read
        if (parsedDocuments.length > 0) {
          for (const doc of parsedDocuments) {
            // Truncate very long documents to avoid exceeding context limits
            const maxLength = 50000;
            const truncatedContent =
              doc.content.length > maxLength
                ? doc.content.substring(0, maxLength) +
                  '\n\n[... Document truncated due to length ...]'
                : doc.content;

            aiContentParts.push({
              type: 'text',
              text: `\n\n---\n**Document: ${doc.fileName}**\n\n${truncatedContent}\n---\n`,
            });
          }
        }

        // Add analyzed image content as text (extracted by vision model)
        if (analyzedImages.length > 0) {
          for (const img of analyzedImages) {
            aiContentParts.push({
              type: 'text',
              text: `\n\n---\n**Image: ${img.fileName}**\n\n${img.analysis}\n---\n`,
            });
          }
        }

        promptContent = [
          {
            role: 'user',
            content: aiContentParts,
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
      promptMessageId,
    });

    const result = await agent.generateText(
      contextWithOrg,
      { threadId },
      // If we have attachments, use prompt array for multi-modal content
      // Otherwise, use the simple string prompt
      // Workflow context is included in the agent's system prompt
      promptContent
        ? { prompt: promptContent, promptMessageId }
        : { prompt: args.message },
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
