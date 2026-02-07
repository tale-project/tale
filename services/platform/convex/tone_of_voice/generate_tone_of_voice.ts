/**
 * Generate tone of voice from example messages using AI
 */

import { internal } from '../_generated/api';
import { ActionCtx } from '../_generated/server';
import { openai } from '../lib/openai_provider';
import { generateObject } from 'ai';
import { z } from 'zod/v4';
import { ExampleMessageContent, GenerateToneResponse } from './types';

export async function generateToneOfVoice(
  ctx: ActionCtx,
  args: { organizationId: string },
): Promise<GenerateToneResponse> {
  try {
    const examples: ExampleMessageContent[] = await ctx.runQuery(
      internal.tone_of_voice.queries.loadExampleMessagesForGeneration,
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
      .map((ex, idx) => `Example ${idx + 1}:\n${ex.content}`)
      .join('\n\n---\n\n');

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

    const generatedTone = result.object.tone;

    await ctx.runMutation(internal.tone_of_voice.mutations.saveGeneratedTone, {
      organizationId: args.organizationId,
      generatedTone,
    });

    return {
      success: true,
      tone: generatedTone,
    };
  } catch (error) {
    console.error('Error generating tone of voice:', error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Failed to generate tone of voice',
    };
  }
}
