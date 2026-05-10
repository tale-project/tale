'use node';

/**
 * AI-powered title generation for saved prompts.
 *
 * Wraps the LLM call in a 10-second timeout. Callers should fall back to a
 * generated PROMPT-XXXXX id if this throws or returns an empty title.
 */

import type { LanguageModelV3 } from '@ai-sdk/provider';
import { Agent } from '@convex-dev/agent';
import { v } from 'convex/values';

import { components } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { buildCallProviderOptions } from '../lib/provider_options';
import { resolveLanguageModelWithFallback } from '../providers/failover';

const TITLE_TIMEOUT_MS = 10_000;

const TITLE_INSTRUCTIONS = `You are a title generator for saved prompt templates.

Given the prompt content below, produce a concise, descriptive title (3-8 words).
- Capture the core intent or topic
- Use title case
- Do not wrap in quotes
- Do not add punctuation at the end
- Return ONLY the title text, nothing else`;

function createTitleGenerator(languageModel: LanguageModelV3): Agent {
  return new Agent(components.agent, {
    name: 'prompt-title-generator',
    languageModel,
    instructions: TITLE_INSTRUCTIONS,
    callSettings: { maxOutputTokens: 64 },
  });
}

/**
 * Race the title generation against a timeout. Returns null on timeout or
 * error so the caller can apply the PROMPT-XXXXX fallback.
 */
export const generatePromptTitle = internalAction({
  args: {
    content: v.string(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args): Promise<string | null> => {
    try {
      const titlePromise = (async (): Promise<string | null> => {
        const { languageModel, modelData } =
          await resolveLanguageModelWithFallback(ctx, {
            tag: 'chat',
          });

        const generator = createTitleGenerator(languageModel);
        const callProviderOptions = buildCallProviderOptions(modelData);
        const userId = `prompt-title-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 9)}`;

        const result = await generator.generateText(
          ctx,
          { userId },
          {
            prompt: args.content.slice(0, 4000),
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

      return await Promise.race([titlePromise, timeoutPromise]);
    } catch (error) {
      console.warn('[generatePromptTitle] AI generation failed:', error);
      return null;
    }
  },
});
