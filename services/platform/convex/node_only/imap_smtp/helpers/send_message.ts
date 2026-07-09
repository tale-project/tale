'use node';

/**
 * Send a message through an SMTP server via nodemailer.
 */

import nodemailer from 'nodemailer';

import type { SendMessageParams, SendMessageResult } from '../types';
import { toNodemailerMailOptions } from './build_outbound_mail';
import { buildSmtpTransportOptions } from './smtp_transport';

export async function sendMessage(
  params: SendMessageParams,
): Promise<SendMessageResult> {
  const transport = nodemailer.createTransport(
    buildSmtpTransportOptions(params.smtp),
  );

  try {
    const info = await transport.sendMail(toNodemailerMailOptions(params));

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
