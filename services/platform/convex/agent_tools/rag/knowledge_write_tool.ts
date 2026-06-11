/**
 * Convex Tool: Knowledge Write
 *
 * Capture a user-confirmed fact as a knowledge entry in the knowledge base.
 * Requires user approval — an approval card will be shown in chat. Writes are
 * topic-keyed: writing to an existing topic replaces (supersedes) the
 * previous version, so the knowledge base never serves two versions of the
 * same fact. Successor to the removed `rag_write` tool.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import {
  CONTENT_MAX_LENGTH,
  TOPIC_MAX_LENGTH,
} from '../../knowledge_entries/constants';
import { getApprovalThreadId } from '../../threads/get_parent_thread_id';
import type { ToolDefinition } from '../types';

export const knowledgeWriteArgs = z.object({
  topic: z
    .string()
    .min(1)
    .max(TOPIC_MAX_LENGTH)
    .describe(
      `Short, stable topic name for this fact (max ${TOPIC_MAX_LENGTH} characters), e.g. "Store opening hours" or "Return policy". Writing to an existing topic replaces its content — reuse the exact topic name when correcting or updating a previously saved fact.`,
    ),
  content: z
    .string()
    .min(1)
    .max(CONTENT_MAX_LENGTH)
    .describe(
      `The knowledge to save, as self-contained markdown (max ${CONTENT_MAX_LENGTH} characters). Write it so it makes sense without the surrounding conversation.`,
    ),
  incorrectInfo: z
    .string()
    .optional()
    .describe(
      'Optional: the outdated or incorrect information this entry corrects, quoted briefly so the reviewer can compare.',
    ),
});

export const knowledgeWriteTool = {
  name: 'knowledge_write' as const,
  tool: createTool({
    description: `Save a user-confirmed fact to the organization's knowledge base as a knowledge entry. Requires user approval — an approval card will be created. When telling the user the card is ready, do not reference its position (no "above" / "below") — just say the approval card has been created.

USE THIS TOOL TO:
• Save a fact the user explicitly confirmed or corrected during the conversation (e.g. "our store hours are 9–5", "the return policy is 3 days, not 7")
• Update a previously saved knowledge entry when the user provides newer information — reuse the SAME topic name so the old version is replaced

WHEN TO USE THIS TOOL:
• The user states a durable, org-relevant fact and asks to remember/save it
• The user corrects information that came from the knowledge base
• Only for facts that should be retrievable by ALL agents searching the knowledge base — for personal user preferences use propose_memory instead

DO NOT USE THIS TOOL FOR:
• Personal preferences about the current user — use propose_memory
• Saving generated files — use document_write
• Searching the knowledge base — use rag_search
• Speculative or unconfirmed information — only save what the user confirmed

PARAMETERS:
• topic: REQUIRED — short, stable topic name (max ${TOPIC_MAX_LENGTH} chars). Writing to an existing topic supersedes its previous content.
• content: REQUIRED — self-contained markdown (max ${CONTENT_MAX_LENGTH} chars).
• incorrectInfo: Optional — the outdated information this entry corrects.`,
    inputSchema: knowledgeWriteArgs,
    execute: async (
      ctx: ToolCtx,
      args,
    ): Promise<{
      success: boolean;
      requiresApproval?: boolean;
      approvalId?: string;
      approvalCreated?: boolean;
      approvalMessage?: string;
      replacesTopic?: string;
      message: string;
      error?: string;
    }> => {
      const { organizationId, threadId: currentThreadId, messageId } = ctx;

      if (!organizationId) {
        return {
          success: false,
          message:
            'organizationId is required in the tool context to write a knowledge entry.',
        };
      }

      const threadId = await getApprovalThreadId(ctx, currentThreadId);

      try {
        const { approvalId, replacesTopic } = await ctx.runMutation(
          internal.knowledge_entries.internal_mutations
            .createKnowledgeWriteApproval,
          {
            organizationId,
            topic: args.topic,
            content: args.content,
            incorrectInfo: args.incorrectInfo,
            threadId,
            messageId,
          },
        );

        const replaceNote = replacesTopic
          ? ` This will REPLACE the existing knowledge entry "${replacesTopic}".`
          : '';

        return {
          success: true,
          requiresApproval: true,
          approvalId: String(approvalId),
          approvalCreated: true,
          replacesTopic: replacesTopic ?? undefined,
          approvalMessage: `APPROVAL CREATED SUCCESSFULLY: An approval card (ID: ${approvalId}) has been created for saving the knowledge entry "${args.topic}".${replaceNote} The user must approve before the entry is saved. Do NOT include suggested follow-ups or next steps — the user needs to act on the approval card first.`,
          message: `The knowledge entry "${args.topic}" is ready to be saved to the knowledge base.${replaceNote} An approval card has been created. The entry will be saved once the user approves.`,
        };
      } catch (error) {
        return {
          success: false,
          message: `Failed to create knowledge write approval: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        };
      }
    },
  }),
} as const satisfies ToolDefinition;
