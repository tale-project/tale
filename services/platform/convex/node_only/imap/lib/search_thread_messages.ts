'use node';

import type { ImapFlow } from 'imapflow';
import type { EmailMessage } from '../../../workflow_engine/action_defs/imap/helpers/types';

import { createDebugLog } from '../../../lib/debug_log';
import collectThreadMessageIds from './collect_thread_message_ids';
import findMessageInFolders from './find_message_in_folders';
import fetchMessagesFromSearchResults from './fetch_messages_from_search_results';
import findRepliesToMessage from './find_replies_to_message';

interface Options {
  threadSearchFolders: string[];
  mailbox: string;
  includeAttachments: boolean;
  parseHtml: boolean;
  skipMessageIdValidation?: boolean;
}

const MAX_THREAD_DEPTH = 100; // Safety limit to prevent infinite loops

const debugLog = createDebugLog('DEBUG_IMAP_THREAD', '[IMAP Thread]');

/**
 * Recursively search for all messages in a thread using BIDIRECTIONAL search.
 *
 * This function uses both backward and forward searching to find ALL messages in a thread,
 * even when References headers are incomplete or broken.
 *
 * Algorithm:
 * 1. Start with initial messages
 * 2. BACKWARD SEARCH: Extract Message-IDs from References/In-Reply-To headers (find parents)
 * 3. FORWARD SEARCH: Search for messages that reference current messages (find children)
 * 4. Fetch all discovered messages
 * 5. Repeat steps 2-4 on newly fetched messages until no new messages found
 *
 * This solves the "broken References chain" problem where a message only references
 * the root message (e.g., F → A) but misses intermediate messages (B, C, D, E).
 *
 * Example:
 *   A (root)
 *   ├── B (reply to A)
 *   ├── C (reply to B)
 *   └── D (reply to C)
 *       └── F (broken: References only A, not B,C,D)
 *
 * Starting from F:
 * - Backward: F → A (from References)
 * - Forward from A: A → B, C, D, F (search for messages referencing A)
 * - Forward from B: B → C (search for messages referencing B)
 * - Forward from C: C → D (search for messages referencing C)
 * - Result: Complete thread A, B, C, D, F
 */
export default async function searchThreadMessages(
  client: ImapFlow,
  messages: EmailMessage[],
  options: Options,
): Promise<EmailMessage[]> {
  if (messages.length === 0) return [];

  debugLog(
    `Starting BIDIRECTIONAL thread search with ${messages.length} initial message(s)`,
  );

  // Track all Message-IDs we've already fetched (including initial messages)
  const fetchedMessageIds = new Set(messages.map((m) => m.messageId));

  // Track all Message-IDs we've seen (to avoid duplicate searches)
  const seenMessageIds = new Set<string>(fetchedMessageIds);

  // All thread messages we've collected
  const threadMessages: EmailMessage[] = [];

  // Queue of messages to process for extracting their thread references
  let messagesToProcess: EmailMessage[] = [...messages];

  let depth = 0;

  // Iteratively process messages until we've explored the entire thread graph
  while (messagesToProcess.length > 0 && depth < MAX_THREAD_DEPTH) {
    depth++;

    debugLog(
      `Depth ${depth}: Processing ${messagesToProcess.length} message(s)`,
    );

    // STEP 1: BACKWARD SEARCH - Extract Message-IDs from References/In-Reply-To headers
    const backwardMessageIds = collectThreadMessageIds(
      messagesToProcess,
      fetchedMessageIds,
    );

    debugLog(
      `Depth ${depth}: Backward search found ${backwardMessageIds.size} parent Message-ID(s)`,
    );

    // STEP 2: FORWARD SEARCH - Find messages that reference current messages
    const forwardMessageIds = new Set<string>();

    for (const message of messagesToProcess) {
      debugLog(
        `Depth ${depth}: Forward searching for replies to ${message.messageId}`,
      );

      const replyResults = await findRepliesToMessage(
        client,
        message.messageId,
        message.subject,
        options.threadSearchFolders,
      );

      // Fetch messages from forward search results
      for (const result of replyResults) {
        for (const uid of result.uids) {
          const foundMessages = await fetchMessagesFromSearchResults(
            client,
            { folder: result.folder, uids: [uid] },
            message.messageId, // For logging context (not used for validation)
            options.mailbox,
            {
              ...options,
              skipMessageIdValidation: true, // Skip validation for forward search
            },
          );

          for (const foundMessage of foundMessages) {
            if (!fetchedMessageIds.has(foundMessage.messageId)) {
              forwardMessageIds.add(foundMessage.messageId);
              fetchedMessageIds.add(foundMessage.messageId);
              threadMessages.push(foundMessage);
              debugLog(
                `Forward search added: ${foundMessage.subject} (${foundMessage.messageId})`,
              );
            }
          }
        }
      }
    }

    debugLog(
      `Depth ${depth}: Forward search found ${forwardMessageIds.size} child Message-ID(s)`,
    );

    // STEP 3: Combine backward and forward Message-IDs
    const allNewMessageIds = new Set([
      ...backwardMessageIds,
      ...forwardMessageIds,
    ]);

    debugLog(
      `Depth ${depth}: Total ${allNewMessageIds.size} new Message-ID(s) to fetch`,
    );

    if (allNewMessageIds.size === 0) {
      // No new Message-IDs to fetch, we're done
      debugLog('No more Message-IDs to fetch, thread complete');
      break;
    }

    // STEP 4: Fetch all messages from backward search
    const newlyFetchedMessages: EmailMessage[] = [];

    for (const messageId of backwardMessageIds) {
      if (seenMessageIds.has(messageId)) continue;
      seenMessageIds.add(messageId);

      const searchResult = await findMessageInFolders(
        client,
        messageId,
        options.threadSearchFolders,
      );

      if (!searchResult) {
        debugLog(`Message-ID not found in any folder: ${messageId}`);
        continue;
      }

      debugLog(
        `Found Message-ID in folder ${searchResult.folder}: ${messageId}`,
      );

      const foundMessages = await fetchMessagesFromSearchResults(
        client,
        searchResult,
        messageId,
        options.mailbox,
        options,
      );

      for (const message of foundMessages) {
        if (!fetchedMessageIds.has(message.messageId)) {
          fetchedMessageIds.add(message.messageId);
          threadMessages.push(message);
          newlyFetchedMessages.push(message);
          debugLog(
            `Backward search added: ${message.subject} (${message.messageId})`,
          );
        }
      }
    }

    debugLog(
      `Depth ${depth}: Fetched ${newlyFetchedMessages.length} new message(s) from backward search`,
    );

    // STEP 5: Process newly fetched messages in the next iteration
    // Include both backward-fetched messages AND forward-fetched messages
    const allNewMessages = [
      ...newlyFetchedMessages,
      ...threadMessages.filter((m) => forwardMessageIds.has(m.messageId)),
    ];

    messagesToProcess = allNewMessages;
  }

  if (depth >= MAX_THREAD_DEPTH) {
    console.warn(
      `[IMAP Thread] Reached max depth of ${MAX_THREAD_DEPTH}. Thread may be incomplete.`,
    );
  }

  debugLog(
    `BIDIRECTIONAL thread search complete: ${threadMessages.length} message(s) found in ${depth} iteration(s)`,
  );

  return threadMessages;
}
