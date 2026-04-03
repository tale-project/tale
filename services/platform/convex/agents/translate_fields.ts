'use node';

import { Agent } from '@convex-dev/agent';
import { z } from 'zod';

import type { ActionCtx } from '../_generated/server';

import { components } from '../_generated/api';
import { resolveLanguageModel } from '../providers/resolve_model';

const MAX_RETRIES = 3;

/**
 * Input shape for translateFields: a record where each value is either
 * a single string or an array of strings. This allows callers to translate
 * any combination of fields in one call (e.g. displayName, description,
 * conversationStarters).
 */
export type TranslateInput = Record<string, string | string[]>;

/**
 * Output mirrors the input shape — same keys, same value types.
 */
export type TranslateOutput = Record<string, string | string[]>;

function createTranslationAgent(
  targetLocale: string,
  languageModel: import('@ai-sdk/provider').LanguageModelV3,
) {
  return new Agent(components.agent, {
    name: 'field-translator',
    languageModel,
    instructions: `You are a translation assistant. Translate the given texts to the locale "${targetLocale}".

Rules:
- Maintain the original meaning and tone
- Keep translations concise and natural
- Translate every item in the input array
- The output array must have the same number of items as the input`,
  });
}

/**
 * Flattens a TranslateInput record into a string array for the LLM,
 * and returns a function to reconstruct the original shape from the
 * translated flat array.
 */
function flattenInput(fields: TranslateInput): {
  flat: string[];
  reconstruct: (translated: string[]) => TranslateOutput;
} {
  const flat: string[] = [];
  const segments: { key: string; length: number; isArray: boolean }[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      segments.push({ key, length: value.length, isArray: true });
      flat.push(...value);
    } else {
      segments.push({ key, length: 1, isArray: false });
      flat.push(value);
    }
  }

  function reconstruct(translated: string[]): TranslateOutput {
    const result: TranslateOutput = {};
    let offset = 0;
    for (const { key, length, isArray } of segments) {
      if (isArray) {
        result[key] = translated.slice(offset, offset + length);
      } else {
        result[key] = translated[offset];
      }
      offset += length;
    }
    return result;
  }

  return { flat, reconstruct };
}

/**
 * Translates a set of fields to the target locale using an LLM.
 *
 * Accepts a generic Record<string, string | string[]> so it can translate
 * any combination of agent fields (displayName, description,
 * conversationStarters, etc.) in a single call.
 *
 * Uses generateObject with a Zod schema for structured output and retries
 * up to 3 times on failure.
 */
export async function translateFields(
  ctx: ActionCtx,
  args: { fields: TranslateInput; targetLocale: string },
): Promise<{ translated: TranslateOutput; error?: string }> {
  const { flat, reconstruct } = flattenInput(args.fields);

  if (flat.length === 0) {
    return { translated: reconstruct([]) };
  }

  const schema = z.object({
    translated: z.array(z.string()).length(flat.length),
  });

  // Resolve chat model from provider files
  const { languageModel } = await resolveLanguageModel(ctx, { tag: 'chat' });

  const agent = createTranslationAgent(args.targetLocale, languageModel);
  const userId = `translate-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const prompt = JSON.stringify(flat);

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await agent.generateObject(
        ctx,
        { userId },
        { prompt, schema },
        { storageOptions: { saveMessages: 'none' } },
      );

      return { translated: reconstruct(result.object.translated) };
    } catch (error) {
      lastError = error;
      console.error(
        `[translateFields] Attempt ${attempt}/${MAX_RETRIES} failed:`,
        error,
      );
    }
  }

  return {
    translated: args.fields,
    error: lastError instanceof Error ? lastError.message : 'Unknown error',
  };
}
