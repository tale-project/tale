/**
 * Reply-From resolution for the email send path (multi-address support).
 *
 * One mailbox can serve many addresses (support@, billing@, …): a reply should
 * go out from whichever address the customer originally wrote to. These pure
 * helpers derive that address and decide when it's safe to send as it.
 */

import { isRecord } from '../../lib/utils/type-utils';

/** Lowercased domain part of an email address, or '' when it has none. */
export function emailDomain(address: string): string {
  const at = address.lastIndexOf('@');
  return at === -1 ? '' : address.slice(at + 1).toLowerCase();
}

/**
 * The address the customer originally wrote to — the conversation's inbound
 * recipient, captured in `metadata.to` (an array of `{ address }`). Undefined
 * when it can't be determined, so the caller falls back to a configured From.
 */
export function inboundRecipientAddress(
  metadata: Record<string, unknown> | undefined,
): string | undefined {
  const to = metadata?.to;
  if (!Array.isArray(to) || to.length === 0) return undefined;
  const first: unknown = to[0];
  if (isRecord(first) && typeof first.address === 'string') {
    return first.address;
  }
  return undefined;
}

/**
 * Choose the reply From: the address the customer wrote to (`inboundFrom`) when
 * it shares the sender's domain, otherwise the configured `fallbackFrom`. The
 * domain guard avoids an unverified From the SMTP provider (e.g. Resend, which
 * is verified per domain) would reject.
 */
export function resolveReplyFrom(
  inboundFrom: string | undefined,
  fallbackFrom: string,
): string {
  return inboundFrom && emailDomain(inboundFrom) === emailDomain(fallbackFrom)
    ? inboundFrom
    : fallbackFrom;
}

/**
 * From address for system notification email on the mailbox's send domain.
 * Falls back to `baseFrom` when it has no `@` (misconfigured SMTP login).
 */
export function notificationFromAddress(baseFrom: string): string {
  const domain = emailDomain(baseFrom);
  return domain ? `notification@${domain}` : baseFrom;
}
