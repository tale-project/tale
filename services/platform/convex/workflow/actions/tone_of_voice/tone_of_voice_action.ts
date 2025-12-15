/**
 * Tone of Voice Action
 *
 * Fetches tone of voice configuration for use in workflows
 */

import { v } from 'convex/values';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import { internal } from '../../../_generated/api';
import type { Doc } from '../../../_generated/dataModel';

import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[Workflow]');

// Type for tone of voice operation params (discriminated union)
type ToneOfVoiceActionParams = { operation: 'get_tone_of_voice' };

export const toneOfVoiceAction: ActionDefinition<ToneOfVoiceActionParams> = {
  type: 'tone_of_voice',
  title: 'Tone of Voice Operation',
  description:
    'Fetch tone of voice configuration (get_tone_of_voice). organizationId is automatically read from workflow context variables.',
  parametersValidator: v.union(
    // get_tone_of_voice: Get the tone of voice configuration
    v.object({
      operation: v.literal('get_tone_of_voice'),
    }),
  ),

  async execute(ctx, params, variables) {
    // Read organizationId from workflow context variables with proper validation
    const organizationId = variables.organizationId;
    if (typeof organizationId !== 'string' || !organizationId) {
      throw new Error(
        'tone_of_voice requires a non-empty string organizationId in workflow context',
      );
    }

    switch (params.operation) {
      case 'get_tone_of_voice': {
        debugLog(
          `tone_of_voice Fetching tone of voice for organization: ${organizationId}`,
        );

        // Call internal query to get tone of voice (bypasses RLS)
        const toneOfVoice = (await ctx.runQuery!(
          internal.tone_of_voice.getToneOfVoiceInternal,
          {
            organizationId,
          },
        )) as Doc<'toneOfVoice'> | null;

        debugLog(
          `tone_of_voice Tone of voice found: ${toneOfVoice ? toneOfVoice._id : 'null'}`,
        );

        // Return tone of voice (can be null if not configured)
        // Note: execute_action_node wraps this in output: { type: 'action', data: result }
        return toneOfVoice;
      }

      default:
        throw new Error(`Unknown operation: ${params.operation}`);
    }
  },
};
