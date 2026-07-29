/**
 * Sender/inbox helpers for the compose dialog.
 *
 * Compose sends through the org's connected inbox providers — the SAME set the
 * Inbox's channel filter derives (installed inbox automations' required
 * connectors, resolved to active credentials via `useRequiredConnectors`).
 * These pure helpers shape a resolved connector into a sender option and
 * validate a dynamic sender address, kept React-free so they're unit-testable
 * without rendering.
 */

/** A connected, email-capable inbox the compose dialog can send through. */
export interface EmailConnectorOption {
  /** Connector slug — passed to the backend as `connectorName`. */
  slug: string;
  /** Human title for the picker (e.g. "Outlook"). */
  title: string;
  /** Connector kind (`imap_smtp` | `rest_api` | …) — drives sender editability. */
  type: string;
  /** Configured send address, when the connector exposes one (imap_smtp). */
  fromAddress?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Shape a resolved inbox connector (the merged file-config + credential object
 * from `useRequiredConnectors`) into a sender option. `slug` is passed
 * explicitly — it is the stable key the backend expects as `connectorName`.
 */
export function resolvedEmailOption(
  slug: string,
  connector: unknown,
): EmailConnectorOption {
  const rec = isRecord(connector) ? connector : {};
  const connectionConfig = rec.connectionConfig;
  const fromAddress =
    isRecord(connectionConfig) &&
    typeof connectionConfig.fromAddress === 'string' &&
    connectionConfig.fromAddress.trim().length > 0
      ? connectionConfig.fromAddress.trim()
      : undefined;
  return {
    slug,
    title:
      typeof rec.title === 'string' && rec.title.trim().length > 0
        ? rec.title
        : slug,
    type: typeof rec.type === 'string' ? rec.type : '',
    fromAddress,
  };
}

/**
 * Whether the sender address is user-choosable for this connector. True only
 * for imap_smtp over a domain-verified SMTP provider (Resend), where any address
 * on the verified domain is valid — and only when we know that domain (a
 * configured `fromAddress`). gmail/outlook send from the fixed OAuth account, so
 * Tale can't override their sender.
 */
export function supportsDynamicSender(
  connector: EmailConnectorOption | null | undefined,
): boolean {
  return (
    connector?.type === 'imap_smtp' &&
    typeof connector.fromAddress === 'string' &&
    emailDomain(connector.fromAddress) !== ''
  );
}

/** Lowercased domain part of an email address, or '' when it has none. */
export function emailDomain(address: string): string {
  const at = address.lastIndexOf('@');
  return at === -1 ? '' : address.slice(at + 1).toLowerCase();
}

/**
 * A candidate sender is valid when it is `localpart@domain` on the given
 * verified `domain`, with a non-empty local part and no whitespace. Mirrors the
 * server-side domain-equality guard (`resolveReplyFrom`), so the UI blocks a
 * mismatch the backend would otherwise silently drop back to the configured From.
 */
export function isSenderAddressValid(
  candidate: string,
  domain: string,
): boolean {
  const trimmed = candidate.trim();
  if (trimmed === '' || /\s/.test(trimmed)) return false;
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return false;
  return emailDomain(trimmed) === domain.toLowerCase();
}
