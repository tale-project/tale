'use node';

import { v } from 'convex/values';
import { saveMessage } from '@convex-dev/agent';
import { action } from '../../_generated/server';
import { components } from '../../_generated/api';
import {
  buildMultiModalContent,
  registerFilesWithAgent,
  type FileAttachment,
} from '../../lib/attachments';
import { getResolveWorkflowRef } from '../../lib/function_refs';
import { authComponent } from '../../auth';
import { generateWorkflowResponse } from './generate_response';

export const chatWithWorkflowAssistant = action({
  args: {
    threadId: v.string(),
    organizationId: v.string(),
    workflowId: v.optional(v.id('wfDefinitions')),
    message: v.string(),
    attachments: v.optional(
      v.array(
        v.object({
          fileId: v.string(),
          fileName: v.string(),
          fileType: v.string(),
          fileSize: v.number(),
        }),
      ),
    ),
  },
  returns: v.object({
    success: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return { success: false, error: 'Unauthenticated' };
    }

    try {
      const additionalContext: Record<string, string> = {};
      if (args.workflowId) {
        const workflow = await ctx.runQuery(getResolveWorkflowRef(), {
          wfDefinitionId: args.workflowId,
        });
        if (workflow) {
          additionalContext.target_workflow_id = String(args.workflowId);
          additionalContext.target_workflow_name = workflow.name;
        }
      }

      let promptMessageId: string | undefined;

      if (args.attachments && args.attachments.length > 0) {
        const fileAttachments: FileAttachment[] = args.attachments.map((a) => ({
          fileId: a.fileId as FileAttachment['fileId'],
          fileName: a.fileName,
          fileType: a.fileType,
          fileSize: a.fileSize,
        }));

        const registeredFiles = await registerFilesWithAgent(
          ctx,
          fileAttachments,
        );

        const { contentParts } = buildMultiModalContent(
          registeredFiles,
          args.message,
        );

        const fileIds = registeredFiles.map((f) => f.agentFileId);

        const { messageId } = await saveMessage(ctx, components.agent, {
          threadId: args.threadId,
          message: {
            role: 'user',
            content: contentParts,
          },
          metadata: fileIds.length > 0 ? { fileIds } : undefined,
        });
        promptMessageId = messageId;
      }

      await generateWorkflowResponse({
        ctx,
        threadId: args.threadId,
        userId: String(authUser._id),
        organizationId: args.organizationId,
        promptMessage: args.message,
        additionalContext:
          Object.keys(additionalContext).length > 0
            ? additionalContext
            : undefined,
        delegationMode: false,
        promptMessageId,
      });

      return { success: true };
    } catch (error) {
      console.error('[chatWithWorkflowAssistant] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});
