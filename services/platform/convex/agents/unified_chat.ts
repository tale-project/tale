'use node';

/**
 * Unified Chat Action
 *
 * Single entry point for chatting with any agent.
 * Reads agent config from JSON file, then delegates to startAgentChat
 * via an internal mutation for transactional stream/message creation.
 */

import { v } from 'convex/values';
import { readFile, stat } from 'node:fs/promises';

import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { authComponent } from '../auth';
import { toSerializableConfig } from './config';
import {
  MAX_FILE_SIZE_BYTES,
  parseAgentJson,
  resolveAgentFilePath,
} from './file_utils';

export const chatWithAgent = action({
  args: {
    agentFileName: v.string(),
    threadId: v.string(),
    organizationId: v.string(),
    orgSlug: v.string(),
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
    additionalContext: v.optional(v.record(v.string(), v.string())),
    userContext: v.optional(
      v.object({
        timezone: v.string(),
        language: v.string(),
      }),
    ),
  },
  returns: v.object({
    messageAlreadyExists: v.boolean(),
    streamId: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ messageAlreadyExists: boolean; streamId: string }> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    // Read agent config from filesystem
    const filePath = resolveAgentFilePath(args.orgSlug, args.agentFileName);
    let content: string;
    try {
      const fileStat = await stat(filePath);
      if (fileStat.size > MAX_FILE_SIZE_BYTES) {
        throw new Error('Agent file too large');
      }
      content = await readFile(filePath, 'utf-8');
    } catch (err) {
      throw new Error(
        `Agent not found: ${args.agentFileName} — ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    const config = parseAgentJson(content);

    // Check role restriction
    if (config.roleRestriction === 'admin_developer') {
      // Role check would go here — for now, allow all authenticated users
      // TODO: implement role check via ctx.runQuery
    }

    // Read optional DB binding for knowledge files
    const binding = await ctx.runQuery(
      internal.agents.internal_queries.getBindingByAgent,
      {
        organizationId: args.organizationId,
        agentFileName: args.agentFileName,
      },
    );

    // Check team access if binding has a teamId
    if (binding?.teamId) {
      // Team access check would go here
      // TODO: implement team access check via ctx.runQuery
    }

    const agentConfig = toSerializableConfig(
      args.agentFileName,
      config,
      binding
        ? {
            teamId: binding.teamId ?? undefined,
            knowledgeFiles: binding.knowledgeFiles ?? undefined,
          }
        : undefined,
    );

    // Delegate to the internal mutation for transactional chat start
    return ctx.runMutation(internal.agents.start_chat.startChat, {
      threadId: args.threadId,
      organizationId: args.organizationId,
      userId: String(authUser._id),
      userEmail: authUser.email,
      userName: authUser.name,
      message: args.message,
      maxSteps: args.maxSteps,
      attachments: args.attachments,
      additionalContext: args.additionalContext,
      userContext: args.userContext,
      agentConfig,
      agentFileName: args.agentFileName,
    });
  },
});
