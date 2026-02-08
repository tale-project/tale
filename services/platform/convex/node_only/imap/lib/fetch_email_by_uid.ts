'use node';

import type { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import extractAddresses from './addresses';
import type { EmailMessage } from '../../../workflow_engine/action_defs/imap/helpers/types';

export interface FetchOptions {
  includeAttachments: boolean;
  parseHtml: boolean;
}

export default async function fetchEmailByUid(
  client: ImapFlow,
  uid: number,
  { includeAttachments, parseHtml }: FetchOptions,
): Promise<EmailMessage | null> {
  const fetched = await client.fetchOne(
    String(uid),
    { source: true, flags: true, uid: true },
    { uid: true },
  );

  if (!fetched || typeof fetched === 'boolean' || !fetched.source) {
    return null;
  }

  const parsed: ParsedMail = await simpleParser(fetched.source);

  const fromList = extractAddresses(parsed.from);
  const toList = extractAddresses(parsed.to);
  const ccList = extractAddresses(parsed.cc);
  const bccList = extractAddresses(parsed.bcc);

  let headers: Record<string, string> | undefined = undefined;
  if (parsed.headers) {
    headers = {};
    for (const [key, value] of parsed.headers.entries()) {
      headers[key] = Array.isArray(value) ? value.join(', ') : String(value);
    }
  }

  const email: EmailMessage = {
    uid: fetched.uid,
    messageId: parsed.messageId || `uid-${fetched.uid}`,
    from: fromList,
    to: toList,
    cc: ccList.length > 0 ? ccList : undefined,
    bcc: bccList.length > 0 ? bccList : undefined,
    subject: parsed.subject || '(no subject)',
    date: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
    text: parsed.text || undefined,
    html: parseHtml ? parsed.html || undefined : undefined,
    flags: fetched.flags ? Array.from(fetched.flags) : [],
    headers,
  };

  if (includeAttachments && parsed.attachments) {
    email.attachments = parsed.attachments.map((att) => ({
      filename: att.filename || 'unnamed',
      contentType: att.contentType || 'application/octet-stream',
      size: att.size || 0,
    }));
  }

  return email;
}
