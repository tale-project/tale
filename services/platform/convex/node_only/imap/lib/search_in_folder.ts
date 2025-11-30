'use node';

import type { ImapFlow } from 'imapflow';

export default async function searchInFolder(
  client: ImapFlow,
  folder: string,
  variants: string[],
): Promise<number[]> {
  const currentMailbox =
    typeof client.mailbox !== 'boolean' ? client.mailbox.path : undefined;
  if (currentMailbox !== folder) {
    try {
      await client.mailboxOpen(folder);
    } catch (e) {
      console.warn(
        `[IMAP Search] Skipping folder '${folder}' - mailboxOpen failed`,
        e,
      );
      return [];
    }
  }

  for (const variant of variants) {
    try {
      const results = await client.search(
        { header: { 'message-id': variant } },
        { uid: true },
      );
      if (Array.isArray(results) && results.length > 0) {
        return results;
      }
    } catch (e) {
      console.warn(
        `[IMAP Search] HEADER message-id search failed in '${folder}', continuing`,
        e,
      );
    }
  }

  return [];
}
