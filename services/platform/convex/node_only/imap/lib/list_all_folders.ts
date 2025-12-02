'use node';

import type { ImapFlow } from 'imapflow';

import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_IMAP', '[IMAP]');

/**
 * List all available folders/mailboxes from the IMAP server.
 *
 * This uses the IMAP LIST command to discover all folders automatically,
 * which is more reliable than heuristics based on host detection.
 *
 * @param client - Connected ImapFlow client
 * @returns Array of folder paths
 */
export default async function listAllFolders(
  client: ImapFlow,
): Promise<string[]> {
  const mailboxes = await client.list();

  // Extract folder paths from the mailbox list
  const folders = mailboxes
    .map((mailbox) => mailbox.path)
    .filter((path) => path && path.length > 0);

  debugLog(`Discovered ${folders.length} folder(s):`, folders);

  return folders;
}
