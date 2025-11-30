'use node';

import { action } from './_generated/server';
import { v } from 'convex/values';
import { createChatAgent } from './lib/create_chat_agent';

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
    try {
      const prompt = args.instruction
        ? `Improve the following message based on this instruction: "${args.instruction}"\n\nOriginal message:\n${args.originalMessage}\n\nIMPORTANT: Return ONLY the improved text directly. Return ONLY the improved text directly with its markdown formatting preserved. Do NOT wrap it in code blocks or add any additional formatting around it.`
        : `Improve the following message by fixing grammar, improving clarity, and making it more professional while maintaining the original tone and intent.\n\nOriginal message:\n${args.originalMessage}\n\nIMPORTANT: Return ONLY the improved text directly. Return ONLY the improved text directly with its markdown formatting preserved. Do NOT wrap it in code blocks or add any additional formatting around it.`;

      // Create agent without tools for simple text improvement
      const agent = await createChatAgent({
        withTools: false,
        maxSteps: 1,
      });

      // Generate improved text with a unique userId for one-off requests
      const userId = `improve-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const result = await agent.generateText(
        ctx,
        { userId },
        {
          prompt,
        },
      );

      // Strip markdown code blocks if the AI added them anyway
      let improvedText = result.text.trim();

      // Remove ```markdown ... ``` or ``` ... ``` wrappers
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
