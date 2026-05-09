'use node';

/**
 * Fire-and-forget AI generation of a chat thread title from the first message.
 *
 * Scheduled from startAgentChat when the thread is empty before the user's
 * first message is saved. Runs with a 10-second timeout and silently logs on
 * failure — the thread keeps its "New Chat" default if generation fails.
 */

import type { LanguageModelV3 } from '@ai-sdk/provider';
import { Agent } from '@convex-dev/agent';
import { v } from 'convex/values';

import { components, internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { buildCallProviderOptions } from '../lib/provider_options';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';
import { resolveLanguageModelWithFallback } from '../providers/failover';
import type { ResolvedModelData } from '../providers/resolve_model';

const TITLE_TIMEOUT_MS = 10_000;

const TITLE_INSTRUCTIONS = `You are a title generator for chat conversations.

Given the user's first message below, produce a concise, descriptive title (3-6 words).
- Capture the core topic or intent
- Use title case
- Do not wrap in quotes
- Do not add punctuation at the end
- Return ONLY the title text, nothing else`;

function createTitleGenerator(
  languageModel: LanguageModelV3,
  modelData: ResolvedModelData,
): Agent {
  const callProviderOptions = buildCallProviderOptions(modelData);
  return new Agent(components.agent, {
    name: 'thread-title-generator',
    languageModel,
    instructions: TITLE_INSTRUCTIONS,
    callSettings: { maxOutputTokens: 48 },
    ...(callProviderOptions ? { providerOptions: callProviderOptions } : {}),
  });
}

export const generateThreadTitle = internalAction({
  args: {
    threadId: v.string(),
    firstMessage: v.string(),
    organizationId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    try {
      const titlePromise = (async (): Promise<string | null> => {
        // Resolve org-scoped provider when organizationId is available so
        // the title uses the org's own API key; fall back to global default
        // when invoked without org context.
        const orgSlug = args.organizationId
          ? await resolveOrgSlug(ctx, args.organizationId)
          : undefined;
        const { languageModel, modelData } =
          await resolveLanguageModelWithFallback(ctx, {
            tag: 'chat',
            orgSlug,
          });

        const generator = createTitleGenerator(languageModel, modelData);
        const userId = `thread-title-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 9)}`;

        const result = await generator.generateText(
          ctx,
          { userId },
          { prompt: args.firstMessage.slice(0, 4000) },
          { storageOptions: { saveMessages: 'none' } },
        );

        const text = (result.text ?? '').trim();
        return text.length > 0 ? text.slice(0, 120) : null;
      })();

      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), TITLE_TIMEOUT_MS),
      );

      const title = await Promise.race([titlePromise, timeoutPromise]);

      if (title) {
        await ctx.runMutation(
          internal.threads.internal_mutations.updateChatThreadInternal,
          { threadId: args.threadId, title },
        );
      }
    } catch (error) {
      console.warn(
        `[generateThreadTitle] Failed for threadId=${args.threadId}:`,
        error,
      );
    }

    return null;
  },
});
