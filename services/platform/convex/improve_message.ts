'use node';

import { action, internalAction } from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';
import { createChatAgent } from './lib/create_chat_agent';
import { checkUserRateLimit } from './lib/rate-limiter/helpers';
import { improveMessageCache } from './lib/action-cache';

const improveMessageArgsValidator = {
  originalMessage: v.string(),
  instruction: v.optional(v.string()),
};

const improveMessageReturnValidator = v.object({
  improvedMessage: v.string(),
  error: v.optional(v.string()),
});

export const improveMessage = action({
  args: improveMessageArgsValidator,
  returns: improveMessageReturnValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity) {
      await checkUserRateLimit(ctx, 'ai:improve', identity.subject);
    }

    return await improveMessageCache.fetch(
      ctx,
      internal.improve_message.improveMessageUncached,
      args,
    );
  },
});

export const improveMessageUncached = internalAction({
  args: improveMessageArgsValidator,
  returns: improveMessageReturnValidator,
  handler: async (ctx, args) => {
    try {
      const prompt = args.instruction
        ? `Improve the following message based on this instruction: "${args.instruction}"\n\nOriginal message:\n${args.originalMessage}\n\nIMPORTANT: Return ONLY the improved text directly. Return ONLY the improved text directly with its markdown formatting preserved. Do NOT wrap it in code blocks or add any additional formatting around it.`
        : `Improve the following message by fixing grammar, improving clarity, and making it more professional while maintaining the original tone and intent.\n\nOriginal message:\n${args.originalMessage}\n\nIMPORTANT: Return ONLY the improved text directly. Return ONLY the improved text directly with its markdown formatting preserved. Do NOT wrap it in code blocks or add any additional formatting around it.`;

      const agent = createChatAgent({
        withTools: false,
        maxSteps: 1,
      });

      const userId = `improve-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const result = await agent.generateText(
        ctx,
        { userId },
        {
          prompt,
        },
      );

      let improvedText = result.text.trim();

      const codeBlockMatch = improvedText.match(
        /^```(?:markdown)?\s*\n([\s\S]*?)\n```$/,
      );
      if (codeBlockMatch) {
        improvedText = codeBlockMatch[1].trim();
      }

      return { improvedMessage: improvedText };
    } catch (error) {
      console.error('Error improving message:', error);
      return {
        improvedMessage: args.originalMessage,
        error:
          error instanceof Error ? error.message : 'Failed to improve message',
      };
    }
  },
});
