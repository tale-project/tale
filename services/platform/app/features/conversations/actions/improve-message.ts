'use server';

import { fetchAction } from '@/lib/convex-server';
import { api } from '@/convex/_generated/api';

export async function improveMessage(
  originalMessage: string,
  instruction?: string,
): Promise<{ improvedMessage: string; error?: string }> {
  try {
    const result = await fetchAction(api.improve_message.actions.improveMessage, {
      originalMessage,
      instruction,
    });

    return result;
  } catch (error) {
    console.error('Error improving message:', error);
    return {
      improvedMessage: originalMessage,
      error: 'IMPROVE_MESSAGE_FAILED',
    };
  }
}
