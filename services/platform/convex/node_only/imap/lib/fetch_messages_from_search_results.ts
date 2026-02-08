'use node';

import type { ImapFlow } from 'imapflow';
import type { EmailMessage } from '../../../workflow_engine/action_defs/imap/helpers/types';
import type { SearchResult } from './find_message_in_folders';
import fetchAndParseMessage from './fetch_and_parse_message';

interface Options {
  includeAttachments: boolean;
  parseHtml: boolean;
  skipMessageIdValidation?: boolean;
}

export default async function fetchMessagesFromSearchResults(
  client: ImapFlow,
  searchResult: SearchResult,
  expectedMessageId: string,
  originalMailbox: string,
  options: Options,
): Promise<EmailMessage[]> {
  const messages: EmailMessage[] = [];
  const needsFolderSwitch = searchResult.folder !== originalMailbox;

  if (needsFolderSwitch) {
    await client.mailboxOpen(searchResult.folder);

    for (const uid of searchResult.uids) {
      const message = await fetchAndParseMessage(
        client,
        uid,
        expectedMessageId,
        options,
      );
      if (message) messages.push(message);
    }

    await client.mailboxOpen(originalMailbox);
  } else {
    for (const uid of searchResult.uids) {
      const message = await fetchAndParseMessage(
        client,
        uid,
        expectedMessageId,
        options,
      );
      if (message) messages.push(message);
    }
  }

  return messages;
}
