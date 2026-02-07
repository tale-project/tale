'use node';

import { v } from 'convex/values';
import { action } from '../_generated/server';
import { authComponent } from '../auth';
import { getEnvOrThrow, getEnvWithDefault } from '../lib/get_or_throw';

export const improveMessage = action({
  args: {
    originalMessage: v.string(),
    instruction: v.optional(v.string()),
  },
  returns: v.object({
    improvedMessage: v.string(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return { improvedMessage: args.originalMessage, error: 'Unauthenticated' };
    }

    const { originalMessage, instruction } = args;

    try {
      const model = getEnvWithDefault('OPENAI_CHAT_MODEL', 'gpt-4o-mini');
      const apiKey = getEnvOrThrow('OPENAI_API_KEY', 'OpenAI API key');

      const systemPrompt = `You are a helpful assistant that improves written messages for clarity, professionalism, and tone.
Your task is to improve the given message while keeping its core meaning intact.
${instruction ? `Additional instruction: ${instruction}` : ''}

Guidelines:
- Maintain the original intent and key points
- Improve grammar, spelling, and punctuation
- Make the tone professional yet friendly
- Keep the message concise but complete
- Return only the improved message without any explanation`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: originalMessage },
          ],
          temperature: 0.7,
          max_tokens: 1024,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('[improveMessage] OpenAI API error:', error);
        return { improvedMessage: originalMessage, error: 'Failed to improve message' };
      }

      const data = await response.json();
      const improvedMessage = data.choices?.[0]?.message?.content?.trim() || originalMessage;

      return { improvedMessage };
    } catch (error) {
      console.error('[improveMessage] Error:', error);
      return {
        improvedMessage: originalMessage,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});
