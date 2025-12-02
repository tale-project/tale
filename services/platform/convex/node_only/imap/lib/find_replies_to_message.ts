'use node';

import type { ImapFlow } from 'imapflow';

import { createDebugLog } from '../../../lib/debug_log';
import normalizeMessageIdForSearch from './normalize_message_id_for_search';

const debugLog = createDebugLog('DEBUG_IMAP', '[IMAP]');

interface SearchResult {
  folder: string;
  uids: number[];
}

/**
 * Search for messages that reply to a given Message-ID (forward search).
 *
 * Strategy:
 *   1. Normalize the subject (strip "Re:", "Fwd:", etc.) and use it for IMAP
 *      SUBJECT search, which is widely supported (Exchange, etc.).
 *   2. For subject matches, fetch ENVELOPE and filter by inReplyTo matching the
 *      normalized Message-ID variants.
 */
export default async function findRepliesToMessage(
  client: ImapFlow,
  messageId: string,
  subject: string,
  folders: string[],
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const variants = normalizeMessageIdForSearch(messageId);
  const baseSubject = (subject || '').trim();

  debugLog(
    `[Forward Search] Searching for replies to Message-ID: ${messageId}. Variants: [${variants.join(', ')}], baseSubject='${baseSubject}'`,
  );

  if (!baseSubject) {
    debugLog(
      `[Forward Search] Subject is empty or whitespace for Message-ID ${messageId}, skipping forward search`,
    );
    return results;
  }

  for (const folder of folders) {
    try {
      await client.mailboxOpen(folder);
    } catch {
      debugLog(
        `[Forward Search] Skipping folder '${folder}' - mailboxOpen failed`,
      );
      continue;
    }

    let candidateUids: number[] = [];
    try {
      const searchResult = await client.search(
        { subject: baseSubject },
        { uid: true },
      );
      candidateUids = Array.isArray(searchResult) ? searchResult : [];
      debugLog(
        `[Forward Search] Folder '${folder}': SUBJECT search for '${baseSubject}' returned UIDs [${candidateUids.join(', ')}]`,
      );
    } catch {
      debugLog(
        `[Forward Search] SUBJECT search failed in folder '${folder}' for baseSubject='${baseSubject}'`,
      );
      continue;
    }

    if (candidateUids.length === 0) continue;

    const uidSet = new Set<number>();

    for (const uid of candidateUids) {
      try {
        const msg = await client.fetchOne(
          String(uid),
          { envelope: true, uid: true },
          { uid: true },
        );

        if (!msg || typeof msg === 'boolean' || !msg.envelope) continue;

        const inReplyToRaw = (msg.envelope.inReplyTo || '').trim();
        if (!inReplyToRaw) continue;

        const inReplyToLower = inReplyToRaw.toLowerCase();
        const matched = variants.some((v) =>
          inReplyToLower.includes(v.toLowerCase()),
        );

        if (matched) {
          uidSet.add(msg.uid);
          debugLog(
            `[Forward Search] Match in folder '${folder}': candidate UID ${msg.uid} with In-Reply-To='${inReplyToRaw}'`,
          );
        }
      } catch {
        debugLog(
          `[Forward Search] Failed to fetch candidate UID ${uid} in folder '${folder}'`,
        );
      }
    }

    const allUids = Array.from(uidSet);

    if (allUids.length > 0) {
      debugLog(
        `[Forward Search] Found ${allUids.length} reply/replies in folder ${folder}`,
      );
      results.push({ folder, uids: allUids });
    }
  }

  debugLog(
    `[Forward Search] Total: ${results.reduce((sum, r) => sum + r.uids.length, 0)} reply/replies found across ${results.length} folder(s)`,
  );

  return results;
}
