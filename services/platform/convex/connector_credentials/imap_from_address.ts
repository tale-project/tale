/**
 * IMAP/SMTP treats the mailbox login and the Conversations From as the same
 * address. The login lives in encrypted basic-auth secrets; the Inbox header
 * and compose UI read non-secret `config.fromAddress`. These helpers keep the
 * public mirror in sync with the username.
 */

/** True when `value` looks like `local@domain` (non-empty local + domain). */
export function looksLikeEmailAddress(value: string): boolean {
  const trimmed = value.trim();
  const at = trimmed.lastIndexOf('@');
  return at > 0 && at < trimmed.length - 1 && !/\s/.test(trimmed);
}

/** The mirrored From already stored on a credential row, when it is usable. */
export function storedImapFromAddress(row: {
  config?: Record<string, string | number | boolean>;
}): string | undefined {
  const stored = row.config?.fromAddress;
  return typeof stored === 'string' && looksLikeEmailAddress(stored)
    ? stored
    : undefined;
}

/**
 * Merge `fromAddress` from the IMAP login username into credential config.
 * Returns `config` unchanged when the connector is not imap-smtp or the
 * username is not an email address.
 */
export function withImapFromAddress(
  connectorSlug: string,
  config: Record<string, string | number | boolean> | undefined,
  username: string | undefined,
): Record<string, string | number | boolean> | undefined {
  if (connectorSlug !== 'imap-smtp') return config;
  const from = username?.trim();
  if (!from || !looksLikeEmailAddress(from)) return config;
  return { ...config, fromAddress: from };
}
