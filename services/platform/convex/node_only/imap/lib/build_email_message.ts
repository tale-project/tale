'use node';

import type { ParsedMail } from 'mailparser';
import type { EmailMessage } from '../../../workflow_engine/action_defs/imap/helpers/types';
import extractAddresses from './addresses';
import parseHeaders from './parse_headers';

interface Options {
  includeAttachments: boolean;
  parseHtml: boolean;
}

export default function buildEmailMessage(
  parsed: ParsedMail,
  uid: number,
  flags: Set<string>,
  options: Options,
): EmailMessage {
  const email: EmailMessage = {
    uid,
    messageId: parsed.messageId || `uid-${uid}`,
    from: extractAddresses(parsed.from),
    to: extractAddresses(parsed.to),
    cc: extractAddresses(parsed.cc),
    bcc: extractAddresses(parsed.bcc),
    subject: parsed.subject || '(no subject)',
    date: parsed.date?.toISOString() || new Date().toISOString(),
    text: parsed.text || undefined,
    html: options.parseHtml ? parsed.html || undefined : undefined,
    flags: Array.from(flags),
    headers: parsed.headers ? parseHeaders(parsed.headers) : undefined,
  };

  if (email.cc?.length === 0) email.cc = undefined;
  if (email.bcc?.length === 0) email.bcc = undefined;

  if (options.includeAttachments && parsed.attachments) {
    email.attachments = parsed.attachments.map((att) => ({
      filename: att.filename || 'unnamed',
      contentType: att.contentType || 'application/octet-stream',
      size: att.size || 0,
    }));
  }

  return email;
}
