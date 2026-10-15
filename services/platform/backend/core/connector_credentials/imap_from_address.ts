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

/**
 * Keep `fromAddress` on the mailbox a credential names (`config.mailbox` —
 * Outlook's shared mailbox): the Inbox, the composer and the sync's
 * direction all read `fromAddress`, and the credential acts on that mailbox,
 * not on the account that signed in. When an edit drops the mailbox, the
 * mirror of it goes too, so the next sync learns the account's own address
 * again instead of filing its mail under the old mailbox. `previous` is the
 * stored config an edit replaces; absent on create.
 */
export function withMailboxFromAddress(
  config: Record<string, string | number | boolean> | undefined,
  previous: Record<string, string | number | boolean> | undefined,
): Record<string, string | number | boolean> | undefined {
  const mailbox = config?.mailbox;
  if (typeof mailbox === 'string' && looksLikeEmailAddress(mailbox)) {
    return withFromAddress(config, mailbox);
  }
  const was = previous?.mailbox;
  if (
    config !== undefined &&
    typeof was === 'string' &&
    config.fromAddress === was
  ) {
    const { fromAddress: _dropped, ...rest } = config;
    return rest;
  }
  return config;
}
