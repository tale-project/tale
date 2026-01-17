'use node';

import type { EmailMessage } from '../../../workflow_engine/actions/imap/helpers/types';

import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_IMAP_THREAD', '[IMAP Thread]');

/**
 * Find the root message(s) in a thread.
 *
 * A root message is one that has no References or In-Reply-To headers,
 * meaning it's the start of a conversation thread.
 *
 * Note: There can be multiple root messages if:
 * - Multiple people started separate conversations that got grouped together
 * - Subject-based grouping merged unrelated threads (not used in current implementation)
 *
 * @param messages - Array of messages in the thread
 * @returns Array of root messages (usually just one)
 */
export default function findRootMessage(
  messages: EmailMessage[],
): EmailMessage[] {
  const rootMessages: EmailMessage[] = [];

  for (const message of messages) {
    const hasReferences = message.headers?.['references'];
    const hasInReplyTo = message.headers?.['in-reply-to'];

    // A message is a root if it has neither References nor In-Reply-To
    if (!hasReferences && !hasInReplyTo) {
      rootMessages.push(message);
      debugLog(
        `Identified root message: ${message.subject} (${message.messageId})`,
      );
    }
  }

  if (rootMessages.length === 0) {
    debugLog(
      'No root message found! All messages have parent references. Using earliest message as root.',
    );
    // Fallback: use the earliest message by date
    const sorted = [...messages].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
    if (sorted.length > 0) {
      rootMessages.push(sorted[0]);
    }
  }

  if (rootMessages.length > 1) {
    debugLog(
      `Found ${rootMessages.length} root messages. This might indicate merged threads.`,
    );
  }

  return rootMessages;
}
