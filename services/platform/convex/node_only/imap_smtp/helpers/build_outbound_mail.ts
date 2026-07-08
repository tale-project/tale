'use node';

/**
 * Build a RFC 822 message for outbound mail (SMTP send + IMAP Sent append).
 */

import nodemailer from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer';

import type { SendMessageParams } from '../types';

// Mail-content fields shared by the SMTP send path and the IMAP Sent append.
// Deliberately omits `smtp` so the append path (which has IMAP creds, not SMTP)
// can build the same RFC 822 message.
export type OutboundMailParams = Omit<SendMessageParams, 'smtp'> & {
  /** RFC 2822 Message-ID from the SMTP send (keeps append in sync with dedup). */
  messageId?: string;
};

export function toNodemailerMailOptions(
  params: OutboundMailParams,
): Mail.Options {
  return {
    from: params.from,
    to: params.to,
    cc: params.cc && params.cc.length > 0 ? params.cc : undefined,
    bcc: params.bcc && params.bcc.length > 0 ? params.bcc : undefined,
    subject: params.subject,
    text: params.text,
    html: params.html,
    messageId: params.messageId,
    inReplyTo: params.inReplyTo,
    references:
      params.references && params.references.length > 0
        ? params.references.join(' ')
        : undefined,
    attachments: params.attachments?.map((att) => ({
      filename: att.filename,
      contentType: att.contentType,
      path: att.url,
    })),
  };
}

export async function buildOutboundRawMessage(
  params: OutboundMailParams,
): Promise<Buffer> {
  const transport = nodemailer.createTransport({
    streamTransport: true,
    newline: 'unix',
    buffer: true,
  });

  try {
    const info = await transport.sendMail(toNodemailerMailOptions(params));
    const message = info.message;
    if (Buffer.isBuffer(message)) {
      return message;
    }
    if (typeof message === 'string') {
      return Buffer.from(message);
    }
    throw new Error('Failed to build outbound raw message');
  } finally {
    transport.close();
  }
}
