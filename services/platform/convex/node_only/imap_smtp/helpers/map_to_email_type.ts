/**
 * Map a parsed IMAP message into the platform's canonical {@link EmailType}.
 *
 * The conversation flow's `normalizeEmail` trusts already-mapped EmailType
 * objects (an object with a `from` array and no Gmail `payload`), so producing
 * this shape lets IMAP messages reuse the exact same downstream machinery as
 * Gmail/Outlook with zero changes to the conversation code.
 *
 * Inbound attachment BINARY download is not wired for IMAP yet (the Gmail path
 * downloads lazily via the connector `get_attachments` op, which IMAP has no
 * sandbox equivalent for). We map attachment METADATA here so attachments are
 * visible on the conversation; persisting their bytes is a follow-up.
 */

import type { AddressObject, ParsedMail } from 'mailparser';

import type { EmailType } from '../../../workflow_engine/action_defs/conversation/helpers/types';

type Addr = { name?: string; address: string };

/**
 * Flatten mailparser's AddressObject (or array of them) into the EmailType
 * `{ name?, address }[]` shape, dropping entries without an address.
 */
function mapAddresses(
  field: AddressObject | AddressObject[] | undefined,
): Addr[] {
  if (!field) return [];
  const objects = Array.isArray(field) ? field : [field];
  const result: Addr[] = [];
  for (const obj of objects) {
    for (const entry of obj.value) {
      if (!entry.address) continue;
      result.push(
        entry.name
          ? { name: entry.name, address: entry.address }
          : { address: entry.address },
      );
    }
  }
  return result;
}

/** Normalize mailparser's `references` (string | string[]) to a single header value. */
function referencesHeader(references: string | string[] | undefined): string {
  if (!references) return '';
  return Array.isArray(references) ? references.join(' ') : references;
}

export function mapToEmailType(
  uid: number,
  flags: string[],
  parsed: ParsedMail,
): EmailType {
  const attachments = parsed.attachments.map((att, index) => {
    const contentId = att.contentId
      ? att.contentId.replace(/^<|>$/g, '')
      : att.cid
        ? att.cid.replace(/^<|>$/g, '')
        : undefined;
    return {
      // IMAP has no separate attachment fetch handle; use the checksum (stable
      // per-attachment) or the part index as an informational id.
      id: att.checksum || `${uid}-${index}`,
      filename: att.filename || 'attachment',
      contentType: att.contentType || 'application/octet-stream',
      size: att.size || 0,
      ...(contentId ? { contentId } : {}),
    };
  });

  return {
    uid,
    messageId: parsed.messageId ? parsed.messageId.replace(/^<|>$/g, '') : '',
    from: mapAddresses(parsed.from),
    to: mapAddresses(parsed.to),
    cc: mapAddresses(parsed.cc),
    bcc: mapAddresses(parsed.bcc),
    subject: parsed.subject || '',
    date: parsed.date ? parsed.date.toISOString() : '',
    text: parsed.text || '',
    html: typeof parsed.html === 'string' ? parsed.html : '',
    flags,
    headers: {
      'message-id': parsed.messageId || '',
      'in-reply-to': parsed.inReplyTo || '',
      references: referencesHeader(parsed.references),
    },
    attachments,
    // Leave direction undefined: createConversationFromEmail derives it from
    // accountEmail, exactly as it does for Gmail/Outlook.
    direction: undefined,
  };
}
