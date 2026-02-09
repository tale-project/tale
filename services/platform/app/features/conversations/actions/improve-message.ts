'use server';

import { api } from '@/convex/_generated/api';
import { fetchAction } from '@/lib/convex-server';

export async function improveMessage(
  originalMessage: string,
  instruction?: string,
): Promise<{ improvedMessage: string; error?: string }> {
  try {
    const result = await fetchAction(api.conversations.actions.improveMessage, {
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
