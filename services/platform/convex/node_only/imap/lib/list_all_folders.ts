'use node';

import type { ImapFlow } from 'imapflow';

import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_IMAP', '[IMAP]');

// Non-selectable folder types in Exchange/Outlook that cannot contain emails
const NON_SELECTABLE_SPECIAL_USES = new Set([
  '\\All',
  '\\Flagged',
  '\\Important',
]);

// Folder name patterns that indicate non-mail folders (Exchange/Outlook specific)
const NON_MAIL_FOLDER_PATTERNS = [
  /^日历/i,
  /^calendar/i,
  /^日记/i,
  /^journal/i,
  /^联系人/i,
  /^contacts/i,
  /^任务/i,
  /^tasks/i,
  /^注释/i,
  /^notes/i,
  /^对话历史记录/i,
  /^conversation history/i,
];

/**
 * List all available folders/mailboxes from the IMAP server.
 *
 * This uses the IMAP LIST command to discover all folders automatically,
 * which is more reliable than heuristics based on host detection.
 *
 * Filters out non-selectable folders (Calendar, Contacts, Tasks, etc.)
 * that cannot contain email messages.
 *
 * @param client - Connected ImapFlow client
 * @returns Array of folder paths that can contain emails
 */
export default async function listAllFolders(
  client: ImapFlow,
): Promise<string[]> {
  const mailboxes = await client.list();

  // Extract folder paths, filtering out non-selectable folders
  const folders = mailboxes
    .filter((mailbox) => {
      // Skip if marked as non-selectable
      if (mailbox.flags?.has('\\Noselect')) {
        return false;
      }

      // Skip special use folders that don't contain emails
      if (
        mailbox.specialUse &&
        NON_SELECTABLE_SPECIAL_USES.has(mailbox.specialUse)
      ) {
        return false;
      }

      // Skip folders matching non-mail patterns (Calendar, Contacts, etc.)
      const path = mailbox.path || '';
      if (NON_MAIL_FOLDER_PATTERNS.some((pattern) => pattern.test(path))) {
        debugLog(`Skipping non-mail folder: ${path}`);
        return false;
      }

      return true;
    })
    .map((mailbox) => mailbox.path)
    .filter((path) => path && path.length > 0);

  debugLog(`Discovered ${folders.length} selectable folder(s):`, folders);

  return folders;
}
