/**
 * Reply-From resolution for the email send path (multi-address support).
 *
 * One mailbox can serve many addresses (support@, billing@, …): a reply should
 * go out from whichever address the customer originally wrote to. These pure
 * helpers derive that address and decide when it's safe to send as it.
 */

import { isRecord } from '../../../lib/utils/type-utils';

/**
 * Consumer / free-mail domains where every local-part is a different person.
 * Same-domain From aliasing is only for org-verified domains (support@ /
 * billing@ on one Resend domain) — treating `gmail.com` as that lets a
 * connected mailbox claim any @gmail.com To as its own From.
 */
const PUBLIC_EMAIL_DOMAINS = new Set([
  'aol.com',
  'gmail.com',
  'gmx.com',
  'gmx.net',
  'googlemail.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'mac.com',
  'mail.com',
  'me.com',
  'msn.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'qq.com',
  'yahoo.com',
  'yandex.com',
  'ymail.com',
  'zoho.com',
]);

/** Lowercased domain part of an email address, or '' when it has none. */
export function emailDomain(address: string): string {
  const at = address.lastIndexOf('@');
  return at === -1 ? '' : address.slice(at + 1).toLowerCase();
}

/** True for consumer mail hosts where local-parts are not org aliases. */
export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has(domain.toLowerCase());
}

/**
 * Whether two addresses may share a mailbox via domain aliasing (billing@ /
 * support@ on one verified domain). Exact address equality is handled by the
 * caller — this is only the same-domain, different-local-part case.
 */
export function sameMailboxAliasDomain(a: string, b: string): boolean {
  const domainA = emailDomain(a);
  const domainB = emailDomain(b);
  return domainA !== '' && domainA === domainB && !isPublicEmailDomain(domainA);
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
 * The address on OUR side of the thread, as the conversation metadata records
 * it. Inbound mail: the recipient the contact wrote to (`metadata.to`).
 * Sent-folder mail synced back from the mailbox (`direction: 'outbound'` with a
 * `metadata.from`, both written by ingest from the real envelope): the sender,
 * because `to` there is the CONTACT, not us. Compose stamps only `metadata.to`
 * (the chosen sender), so a `from`-less outbound thread still reads from `to`.
 */
export function mailboxSideAddress(
  metadata: Record<string, unknown> | undefined,
  direction: 'inbound' | 'outbound' | undefined,
): string | undefined {
  if (direction === 'outbound') {
    const from = metadata?.from;
    const first: unknown = Array.isArray(from) ? from[0] : undefined;
    if (isRecord(first) && typeof first.address === 'string') {
      return first.address;
    }
  }
  return inboundRecipientAddress(metadata);
}

/**
 * Choose the reply From: the address the customer wrote to (`inboundFrom`) when
 * it is the same address or a same-domain alias on a non-public domain;
 * otherwise the configured `fallbackFrom`. The domain guard avoids an
 * unverified From the SMTP provider (e.g. Resend, verified per domain) would
 * reject — and avoids treating every `@gmail.com` To as a From for a connected
 * Gmail mailbox.
 */
export function resolveReplyFrom(
  inboundFrom: string | undefined,
  fallbackFrom: string,
): string {
  if (!inboundFrom) return fallbackFrom;
  if (inboundFrom.toLowerCase() === fallbackFrom.toLowerCase()) {
    return inboundFrom;
  }
  return sameMailboxAliasDomain(inboundFrom, fallbackFrom)
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
