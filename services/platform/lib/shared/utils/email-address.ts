/**
 * Whether a value reads as a mail address — the one test every surface
 * that takes or learns a mailbox's address asks: the IMAP login and the
 * mailbox an Outlook credential names (the `fromAddress` mirror), the
 * credential form that collects that mailbox, and the mail sync that tells
 * the mailbox's own mail from a customer's. One copy, so an address the
 * form accepts is one the server stores and the sync recognizes.
 * Layer A — no imports.
 */

/** True when `value` looks like `local@domain` (non-empty local + domain). */
export function looksLikeEmailAddress(value: string): boolean {
  const trimmed = value.trim();
  const at = trimmed.lastIndexOf('@');
  return at > 0 && at < trimmed.length - 1 && !/\s/.test(trimmed);
}
