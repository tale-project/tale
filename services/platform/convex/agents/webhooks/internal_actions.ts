import { v } from 'convex/values';

import { isRecord, getString } from '../../../lib/utils/type-guards';
import { components, internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';

/**
 * Merge the agent's configured system instructions with optional client-sent
 * system text. Agent first, then literal `\n\n---\n\n`, then client. If
 * either side is empty after trim, the separator is omitted so we never emit
 * a dangling delimiter.
 */
export function mergeSystemInstructions(
  agentInstructions: string | undefined,
  clientSystemPrompt: string | undefined,
): string {
  const agentText = (agentInstructions ?? '').trim();
  const clientText = (clientSystemPrompt ?? '').trim();
  if (!agentText) return clientText;
  if (!clientText) return agentText;
  return `${agentText}\n\n---\n\n${clientText}`;
}

export const chatViaWebhook = internalAction({
  args: {
    agentSlug: v.string(),
    organizationId: v.string(),
    webhookId: v.id('agentWebhooks'),
    message: v.string(),
    threadId: v.optional(v.string()),
    enableStreaming: v.optional(v.boolean()),
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
    /**
     * When set, concatenated onto the resolved agent's `systemInstructions`
     * (agent first, then `\n\n---\n\n`, then this value). Used by the
     * OpenAI-compat webhook sub-path to respect client-sent `system` messages
     * without losing the agent's own framing.
     */
    additionalSystemPrompt: v.optional(v.string()),
    /**
     * SHA-256 hex of the client-supplied OpenAI `user` field. When set, the
     * action looks up (or creates) a stable per-user conversation thread
     * before invoking `startWebhookChat`, so repeated POSTs with the same
     * `user` land in one thread.
     */
    userHash: v.optional(v.string()),
    /**
     * Forwarded to `startWebhookChat` → `startAgentChat` → `onAgentComplete`
     * so audit logs can distinguish the OpenAI-compat wire format
     * (`'openai_webhook'`) from the plain-body webhook (`'custom'`).
     */
    agentType: v.optional(v.string()),
    /**
     * Thread owner ID, typically `webhook.createdByUserId` so that
     * auto-created threads show up in the creator's chat history.
     */
    chatOwnerId: v.optional(v.string()),
  },
  returns: v.object({
    threadId: v.string(),
    streamId: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ threadId: string; streamId: string }> => {
    const org = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'organization',
      where: [{ field: '_id', value: args.organizationId, operator: 'eq' }],
    });

    const orgRecord = isRecord(org) ? org : undefined;
    const orgSlug = orgRecord ? getString(orgRecord, 'slug') : undefined;
    if (!orgSlug) {
      throw new Error('Organization not found');
    }

    const agentConfig = await ctx.runAction(
      internal.agents.file_actions.resolveAgentConfig,
      {
        orgSlug,
        agentSlug: args.agentSlug,
        organizationId: args.organizationId,
      },
    );

    // Layer client system prompt on top of the agent's own instructions.
    // Agent-side wins on identity / format / hard rules; client-side layers
    // use-case specifics (e.g. Meetily's prompt template).
    // Note: the resolved SerializableAgentConfig uses `instructions` (the
    // agent-chat pipeline's field name), not `systemInstructions` (the JSON
    // file field). `toSerializableConfig` maps the former to the latter.
    let effectiveAgentConfig = agentConfig;
    if (args.additionalSystemPrompt && args.additionalSystemPrompt.length > 0) {
      effectiveAgentConfig = {
        ...agentConfig,
        instructions: mergeSystemInstructions(
          agentConfig.instructions,
          args.additionalSystemPrompt,
        ),
      };
    }

    // Thread owner: prefer the webhook creator's Better Auth user ID so
    // the created thread shows up in that user's chat history. Fallback is
    // the synthetic `webhook:<id>` tag (legacy webhooks without the field).
    const chatOwnerId = args.chatOwnerId ?? `webhook:${args.webhookId}`;

    // Resolve the client-supplied `user` hash (if any) to a stable thread
    // before entering `startWebhookChat`, so that repeated POSTs land in
    // the same agent conversation.
    let threadId = args.threadId;
    if (!threadId && args.userHash) {
      const lookup = await ctx.runMutation(
        internal.agents.webhooks.internal_mutations.getOrCreateUserThread,
        {
          webhookId: args.webhookId,
          organizationId: args.organizationId,
          userHash: args.userHash,
          chatOwnerId,
        },
      );
      threadId = lookup.threadId;
    }

    return ctx.runMutation(
      internal.agents.webhooks.internal_mutations.startWebhookChat,
      {
        agentSlug: args.agentSlug,
        organizationId: args.organizationId,
        webhookId: args.webhookId,
        message: args.message,
        threadId,
        enableStreaming: args.enableStreaming,
        attachments: args.attachments,
        agentConfig: effectiveAgentConfig,
        agentType: args.agentType,
        chatOwnerId,
      },
    );
  },
});
