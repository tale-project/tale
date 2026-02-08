'use node';

import type { EmailMessage } from '../../../workflow_engine/action_defs/imap/helpers/types';
import extractThreadMessageIds from './extract_thread_message_ids';

export default function collectThreadMessageIds(
  messages: EmailMessage[],
  fetchedMessageIds: Set<string>,
): Set<string> {
  const threadMessageIds = new Set<string>();

  for (const message of messages) {
    const ids = extractThreadMessageIds(message.headers);
    for (const id of ids) {
      if (!fetchedMessageIds.has(id)) {
        threadMessageIds.add(id);
      }
    }
  }

  return threadMessageIds;
}
