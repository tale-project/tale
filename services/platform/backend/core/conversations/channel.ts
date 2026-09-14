/**
 * What KIND of thing a conversation is carried on, and what that means for the
 * outbound half.
 *
 * Every conversation the mailbox sync creates is stamped `channel: 'email'`,
 * and for a long time that was the only value: the send lane built RFC
 * threading headers, needed a contact address, and dispatched to a mail
 * connector. A conversation opened by a product that owns its own
 * customer-facing surface has none of those — its recipient is an id in that
 * product's vocabulary, its thread is not a mail thread, and its reply goes
 * back over a webhook.
 *
 * The rules here are deliberately small, and the defaults preserve today's
 * behaviour: a row whose `channel` was never written reads as email, which is
 * what every existing row is.
 */

/** The channel a mailbox conversation is on, and the default for a row that
 * never had one written. */
export const EMAIL_CHANNEL = 'email';

/** The connector slug that delivers a non-mail channel to its own product. */
export const WEBHOOK_CHANNEL_CONNECTOR = 'webhook-channel';

/** A conversation's channel, with the email default applied. */
export function conversationChannel(
  channel: string | null | undefined,
): string {
  return channel === null || channel === undefined || channel.trim() === ''
    ? EMAIL_CHANNEL
    : channel;
}

/**
 * Whether this conversation is carried on email — the question the send lane
 * asks before it builds a reply subject, threading headers, or looks for a
 * contact address. Each of those is meaningless off a mail channel.
 */
export function isEmailChannel(channel: string | null | undefined): boolean {
  return conversationChannel(channel) === EMAIL_CHANNEL;
}
