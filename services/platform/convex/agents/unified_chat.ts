/**
 * Unified Chat Action
 *
 * Single entry point for chatting with any agent.
 * Delegates filesystem I/O to resolveAgentConfig (Node action),
 * then starts the chat via an internal mutation.
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { authComponent } from '../auth';
import { scrubPii, type PiiConfig } from '../governance/pii';

export const chatWithAgent = action({
  args: {
    agentSlug: v.string(),
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
    modelId: v.optional(v.string()),
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

    // PII scrubbing: fetch governance policy and apply if enabled
    const piiPolicy = await ctx.runQuery(
      internal.governance.internal_queries.getPiiConfigInternal,
      { organizationId: args.organizationId },
    );

    let message = args.message;
    if (piiPolicy?.enabled && piiPolicy.config) {
      const piiConfig: PiiConfig = {
        enabled: true,
        mode: piiPolicy.config.mode,
        enabledPatterns: piiPolicy.config.enabledPatterns,
        customPatterns: piiPolicy.config.customPatterns,
      };

      const result = scrubPii(message, piiConfig);
      message = result.text;

      if (result.matchCount > 0) {
        await ctx.runMutation(
          internal.audit_logs.internal_mutations.createAuditLog,
          {
            organizationId: args.organizationId,
            actorId: String(authUser._id),
            actorEmail: authUser.email,
            actorType: 'user',
            action: 'pii.detected_in_chat',
            category: 'security',
            resourceType: 'chat_message',
            resourceId: args.threadId,
            status: 'success',
            metadata: {
              detectedTypes: result.detectedTypes,
              matchCount: result.matchCount,
              mode: piiConfig.mode,
              agentSlug: args.agentSlug,
            },
          },
        );
      }
    }

    const agentConfig = await ctx.runAction(
      internal.agents.file_actions.resolveAgentConfig,
      {
        orgSlug: args.orgSlug,
        agentSlug: args.agentSlug,
        organizationId: args.organizationId,
        modelId: args.modelId,
      },
    );

    // Delegate to the internal mutation for transactional chat start
    return ctx.runMutation(internal.agents.start_chat.startChat, {
      threadId: args.threadId,
      organizationId: args.organizationId,
      userId: String(authUser._id),
      userEmail: authUser.email,
      userName: authUser.name,
      message,
      maxSteps: args.maxSteps,
      attachments: args.attachments,
      additionalContext: args.additionalContext,
      userContext: args.userContext,
      agentConfig,
      agentSlug: args.agentSlug,
    });
  },
});
