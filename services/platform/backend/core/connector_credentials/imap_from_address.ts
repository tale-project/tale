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
 * Merge a mailbox address into credential config as `fromAddress` — the
 * public mirror every mail connector's Inbox header, composer and sync read.
 * Returns `config` unchanged when the address is not an email address.
 */
export function withFromAddress(
  config: Record<string, string | number | boolean> | undefined,
  address: string | undefined,
): Record<string, string | number | boolean> | undefined {
  const from = address?.trim();
  if (!from || !looksLikeEmailAddress(from)) return config;
  return { ...config, fromAddress: from };
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
  return withFromAddress(config, username);
}
