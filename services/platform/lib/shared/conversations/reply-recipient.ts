/**
 * Who a reply reaches — one rule for the reply door (`replyToConversation`)
 * and every Inbox composer, so a bulk send cannot refuse a conversation that
 * a single reply and the door answer (#3912).
 *
 * A conversation mirrored over the REST API (`channel: 'api'`) is answered
 * through its source's delivery queue, which needs no address. Every other
 * conversation is answered by email, so its contact needs a real address:
 * not blank, and not the stand-in an Inbox row carries for a contact without
 * one.
 */

/** The address an Inbox row shows for an email contact without one; never a
 * recipient. A mirrored conversation's row shows a blank instead. */
export const UNKNOWN_CONTACT_EMAIL = 'unknown@example.com';

export function hasReplyRecipient(conversation: {
  channel?: string | null;
  contactEmail?: string | null;
}): boolean {
  if (conversation.channel === 'api') return true;
  return (
    Boolean(conversation.contactEmail) &&
    conversation.contactEmail !== UNKNOWN_CONTACT_EMAIL
  );
}
