/**
 * Tone of Voice Action
 *
 * Fetches tone of voice configuration for use in workflows
 */

import { v } from 'convex/values';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import { internal } from '../../../_generated/api';
import type { Doc } from '../../../_generated/dataModel';

export const toneOfVoiceAction: ActionDefinition<{
  operation: 'get_tone_of_voice';
  organizationId: string;
}> = {
  type: 'tone_of_voice',
  title: 'Tone of Voice Operation',
  description: 'Fetch tone of voice configuration (get_tone_of_voice)',
  parametersValidator: v.object({
    operation: v.literal('get_tone_of_voice'),
    organizationId: v.string(),
  }),

  async execute(ctx, params) {
    switch (params.operation) {
      case 'get_tone_of_voice': {
        if (!params.organizationId) {
          throw new Error(
            'get_tone_of_voice operation requires organizationId parameter',
          );
        }

        console.log(
          `[tone_of_voice] Fetching tone of voice for organization: ${params.organizationId}`,
        );

        // Call internal query to get tone of voice (bypasses RLS)
        const toneOfVoice = (await ctx.runQuery!(
          internal.tone_of_voice.getToneOfVoiceInternal,
          {
            organizationId: params.organizationId,
          },
        )) as Doc<'toneOfVoice'> | null;

        console.log(
          `[tone_of_voice] Tone of voice found: ${toneOfVoice ? toneOfVoice._id : 'null'}`,
        );

        // Return tone of voice (can be null if not configured)
        return {
          operation: 'get_tone_of_voice',
          ...(toneOfVoice || {}),
          timestamp: Date.now(),
        };
      }

      default:
        throw new Error(`Unknown operation: ${params.operation}`);
    }
  },
};

