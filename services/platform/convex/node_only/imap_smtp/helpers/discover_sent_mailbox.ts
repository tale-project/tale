/**
 * Locate the Sent mail folder on an IMAP server.
 *
 * Servers name and nest Sent folders differently; SPECIAL-USE (`\\Sent`) is the
 * most reliable signal when supported. Falls back to configured name and common
 * provider defaults.
 */

export interface ListableMailbox {
  path: string;
  flags: Set<string>;
  specialUse?: string;
}

export const COMMON_SENT_MAILBOX_NAMES = [
  'Sent',
  'Sent Items',
  'Sent Messages',
  'Sent Mail',
  '[Gmail]/Sent Mail',
  'INBOX.Sent',
  'INBOX/Sent',
] as const;

function isSelectable(mailbox: ListableMailbox): boolean {
  return !mailbox.flags.has('\\Noselect');
}

function pathLeaf(path: string): string {
  const segments = path.split(/[./]/);
  return segments[segments.length - 1] ?? path;
}

export function discoverSentMailboxPath(
  mailboxes: ListableMailbox[],
  preferred?: string,
): string | null {
  const selectable = mailboxes.filter(isSelectable);

  const bySpecialUse = selectable.find(
    (mailbox) => mailbox.specialUse === '\\Sent',
  );
  if (bySpecialUse) {
    return bySpecialUse.path;
  }

  const paths = selectable.map((mailbox) => mailbox.path);

  const preferredTrimmed = preferred?.trim();
  if (preferredTrimmed) {
    const exact = paths.find((path) => path === preferredTrimmed);
    if (exact) return exact;

    const caseInsensitive = paths.find(
      (path) => path.toLowerCase() === preferredTrimmed.toLowerCase(),
    );
    if (caseInsensitive) return caseInsensitive;
  }

  for (const candidate of COMMON_SENT_MAILBOX_NAMES) {
    const exact = paths.find((path) => path === candidate);
    if (exact) return exact;

    const caseInsensitive = paths.find(
      (path) => path.toLowerCase() === candidate.toLowerCase(),
    );
    if (caseInsensitive) return caseInsensitive;
  }

  const preferredLeaf = preferredTrimmed
    ? pathLeaf(preferredTrimmed).toLowerCase()
    : undefined;

  for (const candidate of [
    ...(preferredLeaf ? [preferredLeaf] : []),
    ...COMMON_SENT_MAILBOX_NAMES.map((name) => pathLeaf(name).toLowerCase()),
  ]) {
    const match = paths.find(
      (path) => pathLeaf(path).toLowerCase() === candidate,
    );
    if (match) return match;
  }

  return null;
}
