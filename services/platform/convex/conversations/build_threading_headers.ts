/**
 * Build email threading headers (In-Reply-To + References) for outbound messages.
 *
 * - In-Reply-To: the Message-ID of the message being replied to (latest message).
 * - References: root message ID + latest message ID (for proper thread grouping).
 */
export function buildThreadingHeaders(opts: {
  /** Caller-provided In-Reply-To (takes precedence). */
  inReplyTo?: string;
  /** Caller-provided References (takes precedence). */
  references?: Array<string>;
  /** External Message-ID of the latest message in the conversation. */
  latestMessageExternalId?: string;
  /** External Message-ID stored on the conversation (root). */
  conversationExternalMessageId?: string;
}): { inReplyTo?: string; references?: Array<string> } {
  let inReplyTo = opts.inReplyTo;
  let references = opts.references;

  if (!inReplyTo) {
    inReplyTo =
      opts.latestMessageExternalId ?? opts.conversationExternalMessageId;
  }

  if (!references && inReplyTo) {
    const rootId = opts.conversationExternalMessageId;
    references =
      rootId && rootId !== inReplyTo ? [rootId, inReplyTo] : [inReplyTo];
  }

  return { inReplyTo, references };
}
