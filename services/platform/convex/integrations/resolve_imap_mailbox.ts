/**
 * Resolve which IMAP mailbox/folder to read for sync.
 *
 * Workflows pass the sentinel `sent` to read the configured sent-mail folder;
 * otherwise an explicit folder name or undefined (INBOX default).
 */

export function resolveImapMailbox(
  connectionConfig: Record<string, unknown> | undefined,
  mailboxParam: string | undefined,
): { mailbox: string | undefined; isSentFolder: boolean } {
  if (mailboxParam?.trim().toLowerCase() === 'sent') {
    const configured = connectionConfig?.sentMailbox;
    if (typeof configured === 'string' && configured.trim()) {
      return { mailbox: configured.trim(), isSentFolder: true };
    }
    return { mailbox: 'Sent', isSentFolder: true };
  }

  if (typeof mailboxParam === 'string' && mailboxParam.trim()) {
    return { mailbox: mailboxParam.trim(), isSentFolder: false };
  }

  return { mailbox: undefined, isSentFolder: false };
}
