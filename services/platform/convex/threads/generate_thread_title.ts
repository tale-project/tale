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
import { reasoningProviderOptionsFor } from '../lib/agent_response/reasoning/build_reasoning_options';
import { renderPrompt } from '../lib/prompts/registry';
import { buildCallProviderOptions } from '../lib/provider_options';
import { resolveLanguageModelWithFallback } from '../providers/failover';
import { deriveFallbackTitle } from './derive_fallback_title';

const TITLE_TIMEOUT_MS = 10_000;

const TITLE_INSTRUCTIONS = renderPrompt('title.thread');

function createTitleGenerator(languageModel: LanguageModelV3): Agent {
  return new Agent(components.agent, {
    name: 'thread-title-generator',
    languageModel,
    instructions: TITLE_INSTRUCTIONS,
    callSettings: { maxOutputTokens: 48 },
  });
}

export const generateThreadTitle = internalAction({
  args: {
    threadId: v.string(),
    firstMessage: v.string(),
    organizationId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    try {
      const titlePromise = (async (): Promise<string | null> => {
        const { languageModel, modelData } =
          await resolveLanguageModelWithFallback(ctx, {
            tag: 'chat',
            organizationId: args.organizationId,
          });

        const generator = createTitleGenerator(languageModel);
        // Title generation is mechanical — force minimal reasoning so a
        // reasoning-capable model doesn't deliberate over a one-line title.
        const callProviderOptions = reasoningProviderOptionsFor(
          modelData,
          buildCallProviderOptions(modelData),
          { kind: 'utility' },
        );
        const userId = `thread-title-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 9)}`;

        const result = await generator.generateText(
          ctx,
          { userId },
          {
            prompt: args.firstMessage.slice(0, 4000),
            ...(callProviderOptions
              ? { providerOptions: callProviderOptions }
              : {}),
          },
          { storageOptions: { saveMessages: 'none' } },
        );

        const text = (result.text ?? '').trim();
        return text.length > 0 ? text.slice(0, 120) : null;
      })();

      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), TITLE_TIMEOUT_MS),
      );

      const aiTitle = await Promise.race([titlePromise, timeoutPromise]);

      // Prefer the AI title; on failure/timeout/empty fall back to a trimmed
      // slice of the user's first message so the thread gets a distinctive
      // title instead of staying the generic "New Chat" — which made every
      // failed/timed-out thread look identical. See #1981.
      const title = aiTitle ?? deriveFallbackTitle(args.firstMessage);

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
