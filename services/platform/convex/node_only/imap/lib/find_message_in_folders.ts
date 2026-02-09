'use node';

import type { ImapFlow } from 'imapflow';

import normalizeMessageIdForSearch from './normalize_message_id_for_search';
import searchInFolder from './search_in_folder';

export interface SearchResult {
  uids: number[];
  folder: string;
}

export default async function findMessageInFolders(
  client: ImapFlow,
  messageId: string,
  folders: string[],
): Promise<SearchResult | null> {
  const variants = normalizeMessageIdForSearch(messageId);

  for (const folder of folders) {
    const uids = await searchInFolder(client, folder, variants);
    if (uids.length > 0) return { uids, folder };
  }

  return null;
}
