/**
 * Regenerate tone of voice (same as generate but for existing tone)
 * This is implemented as a wrapper for consistency with the API
 */

import { ActionCtx } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { GenerateToneResponse } from './types';

export async function regenerateToneOfVoice(
  ctx: ActionCtx,
  args: { organizationId: string },
): Promise<GenerateToneResponse> {
  // Implementation is identical to generateToneOfVoice
  try {
    const examples = await ctx.runQuery(
      internal.tone_of_voice.queries.load_example_messages_for_generation.loadExampleMessagesForGeneration,
      {
        organizationId: args.organizationId,
      },
    );

    if (examples.length === 0) {
      return {
        success: false,
        error: 'No example messages found. Please add at least one example.',
      };
    }

    const examplesText = examples
      .map(
        (ex: { content: string }, idx: number) =>
          `Example ${idx + 1}:\n${ex.content}`,
      )
      .join('\n\n---\n\n');

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return {
        success: false,
        error: 'OpenAI API key not configured',
      };
    }

    const result = await generateObject({
      model: openai('gpt-4o'),
      schema: z.object({
        tone: z
          .string()
          .describe(
            'A well-formatted, comprehensive tone of voice description with proper line breaks',
          ),
      }),
      prompt: `Analyze these message examples and generate a comprehensive tone of voice description for the brand.

IMPORTANT: You must respond with ONLY a JSON object in this exact format:
{
  "tone": "your detailed tone description here with \\n for new lines"
}

The tone description should be well-formatted with clear sections separated by line breaks. Include:

1. Overall Voice Characteristics (2-3 adjectives with brief explanation)
2. Key Language Patterns (specific examples from the messages)
3. Sentence Structure (how sentences are typically constructed)
4. Emotional Tone (the feeling conveyed)
5. Unique Stylistic Elements (any distinctive features)

Examples:
${examplesText}

Format your response with proper line breaks between sections for readability. Use \\n\\n for paragraph breaks and \\n for single line breaks. Make it clear, actionable, and well-structured.`,
    });

    const generatedTone: string = result.object.tone;

    await ctx.runMutation(internal.tone_of_voice.mutations.save_generated_tone.saveGeneratedTone, {
      organizationId: args.organizationId,
      generatedTone,
    });

    return {
      success: true,
      tone: generatedTone,
    };
  } catch (error) {
    console.error('Error regenerating tone of voice:', error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Failed to regenerate tone of voice',
    };
  }
}
