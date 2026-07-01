'use node';

/**
 * Send a message through an SMTP server via nodemailer.
 */

import nodemailer from 'nodemailer';

import type { SendMessageParams, SendMessageResult } from '../types';

export async function sendMessage(
  params: SendMessageParams,
): Promise<SendMessageResult> {
  const transport = nodemailer.createTransport({
    host: params.smtp.host,
    port: params.smtp.port,
    secure: params.smtp.secure,
    auth: { user: params.smtp.user, pass: params.smtp.password },
  });

  try {
    const info = await transport.sendMail({
      from: params.from,
      to: params.to,
      cc: params.cc && params.cc.length > 0 ? params.cc : undefined,
      bcc: params.bcc && params.bcc.length > 0 ? params.bcc : undefined,
      subject: params.subject,
      text: params.text,
      html: params.html,
      inReplyTo: params.inReplyTo,
      references:
        params.references && params.references.length > 0
          ? params.references
          : undefined,
      attachments: params.attachments?.map((att) => ({
        filename: att.filename,
        contentType: att.contentType,
        // nodemailer streams the bytes from the Convex storage URL.
        path: att.url,
      })),
    });

    return { success: true, messageId: info.messageId };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'SMTP send failed',
    };
  } finally {
    transport.close();
  }
}
