import { Agent } from '@convex-dev/agent';

import type { ActionCtx } from '../_generated/server';

import { components } from '../_generated/api';
import { getFastModel } from '../lib/agent_runtime_config';
import { openai } from '../lib/openai_provider';

function createTranslationAgent(targetLocale: string) {
  const model = getFastModel();

  return new Agent(components.agent, {
    name: 'field-translator',
    languageModel: openai.chatModel(model),
    instructions: `You are a translation assistant. Translate the given texts to the locale "${targetLocale}".

Rules:
- Maintain the original meaning and tone
- Keep translations concise and natural
- Return ONLY a JSON array of translated strings, nothing else
- The output array must have the same number of items as the input
- Do not add explanations or formatting outside the JSON array`,
  });
}

export async function translateFields(
  ctx: ActionCtx,
  args: { fields: string[]; targetLocale: string },
): Promise<{ translated: string[]; error?: string }> {
  if (args.fields.length === 0) {
    return { translated: [] };
  }

  try {
    const agent = createTranslationAgent(args.targetLocale);
    const userId = `translate-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const prompt = JSON.stringify(args.fields);
    const result = await agent.generateText(
      ctx,
      { userId },
      { prompt },
      { storageOptions: { saveMessages: 'none' } },
    );

    const parsed: unknown = JSON.parse(result.text);
    if (
      !Array.isArray(parsed) ||
      parsed.length !== args.fields.length ||
      !parsed.every((item) => typeof item === 'string')
    ) {
      return {
        translated: args.fields,
        error: 'Translation returned unexpected format',
      };
    }

    return { translated: parsed };
  } catch (error) {
    console.error('[translateFields] Error:', error);
    return {
      translated: args.fields,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
