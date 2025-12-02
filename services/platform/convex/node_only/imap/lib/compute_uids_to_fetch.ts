'use node';

import type { ImapFlow } from 'imapflow';

import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_IMAP', '[IMAP]');

/**
 * Compute which UID to fetch (returns a single UID or null)
 *
 * IMPORTANT: ImapFlow's client.fetch() returns a native async generator, but it maintains
 * internal state (IMAP command queue, network buffers, protocol state machine) that is NOT
 * properly cleaned up when you break/return early from the for-await loop.
 *
 * Even though JavaScript calls the iterator's return() method when you break/return early,
 * ImapFlow's internal state remains inconsistent, causing subsequent operations like
 * fetchOne() to hang indefinitely.
 *
 * SOLUTION: Always let the async iterator complete naturally by collecting all results.
 * This ensures ImapFlow's internal cleanup happens properly.
 *
 * Tested approaches:
 * - Using `return` in loop: ❌ Hangs on next fetchOne()
 * - Using `break` in loop: ❌ Still hangs on next fetchOne()
 * - Fully consuming iterator: ✅ Works reliably
 */
export default async function computeUidToFetch(
  client: ImapFlow,
  totalMessages: number,
  afterUid?: number,
): Promise<number | null> {
  if (afterUid && afterUid > 0) {
    const searchRange = `${afterUid + 1}:*`;
    debugLog(
      `Computing UID to fetch after ${afterUid}, searching range: ${searchRange}`,
    );
    // Collect all UIDs - must fully consume the iterator
    const fetchedMessages: { uid: number }[] = [];
    for await (const message of client.fetch(
      searchRange,
      { uid: true },
      { uid: true },
    )) {
      debugLog(`Fetched message with UID: ${message.uid}`);
      fetchedMessages.push({ uid: message.uid });
    }

    // Filter to only include UIDs that are actually > afterUid
    // Some IMAP servers return the highest UID even when the range is beyond it
    const validMessages = fetchedMessages.filter((m) => m.uid > afterUid);
    validMessages.sort((a, b) => a.uid - b.uid);

    const result = validMessages.length > 0 ? validMessages[0].uid : null;
    debugLog(
      `Found ${fetchedMessages.length} message(s) from server, ${validMessages.length} with UID > ${afterUid}, all UIDs: [${fetchedMessages.map((m) => m.uid).join(', ')}], returning UID: ${result}`,
    );
    return result;
  } else {
    debugLog(`Computing latest UID (no afterUid specified)`);
    // Fetch latest message - must fully consume the iterator
    const latestSeq = totalMessages;
    const fetchedMessages: { uid: number }[] = [];
    for await (const message of client.fetch(String(latestSeq), {
      uid: true,
    })) {
      fetchedMessages.push({ uid: message.uid });
    }
    const result = fetchedMessages.length > 0 ? fetchedMessages[0].uid : null;
    debugLog(`Latest UID: ${result}`);
    return result;
  }
}
