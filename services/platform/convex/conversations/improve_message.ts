import { Agent } from '@convex-dev/agent';

import type { ActionCtx } from '../_generated/server';

import { components } from '../_generated/api';
import { getEnvOrThrow } from '../lib/get_or_throw';
import { openai } from '../lib/openai_provider';

function createImproveMessageAgent(instruction?: string) {
  const model = getEnvOrThrow(
    'OPENAI_FAST_MODEL',
    'Fast model for message improvement',
  );

  return new Agent(components.agent, {
    name: 'message-improver',
    languageModel: openai.chat(model),
    instructions: `You are a helpful assistant that improves written messages for clarity, professionalism, and tone.
Your task is to improve the given message while keeping its core meaning intact.
${instruction ? `Additional instruction: ${instruction}` : ''}

Guidelines:
- Maintain the original intent and key points
- Improve grammar, spelling, and punctuation
- Make the tone professional yet friendly
- Keep the message concise but complete
- Return only the improved message without any explanation`,
  });
}

export async function improveMessage(
  ctx: ActionCtx,
  args: { originalMessage: string; instruction?: string },
): Promise<{ improvedMessage: string; error?: string }> {
  try {
    const agent = createImproveMessageAgent(args.instruction);
    const userId = `improve-msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const result = await agent.generateText(
      ctx,
      { userId },
      { prompt: args.originalMessage },
      { storageOptions: { saveMessages: 'none' } },
    );

    return { improvedMessage: result.text || args.originalMessage };
  } catch (error) {
    console.error('[improveMessage] Error:', error);
    return {
      improvedMessage: args.originalMessage,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
