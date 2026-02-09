'use node';

import { v } from 'convex/values';
import nodemailer from 'nodemailer';

import { internalAction } from '../../_generated/server';
import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_EMAIL', '[Email]');

/**
 * Internal action to send an email via SMTP
 * Returns the message ID from the SMTP server
 */
export const sendEmail = internalAction({
  args: {
    smtpConfig: v.object({
      host: v.string(),
      port: v.number(),
      secure: v.boolean(),
    }),
    passwordAuth: v.optional(
      v.object({
        user: v.string(),
        pass: v.string(),
      }),
    ),
    oauth2Auth: v.optional(
      v.object({
        user: v.string(),
        accessToken: v.string(),
      }),
    ),
    from: v.string(),
    to: v.array(v.string()),
    cc: v.optional(v.array(v.string())),
    bcc: v.optional(v.array(v.string())),
    subject: v.string(),
    html: v.optional(v.string()),
    text: v.optional(v.string()),
    replyTo: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    references: v.optional(v.array(v.string())),
    headers: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.object({
    success: v.boolean(),
    messageId: v.string(),
  }),
  handler: async (_ctx, args) => {
    // Prepare auth configuration
    let auth:
      | { user: string; pass: string }
      | { type: string; user: string; accessToken: string }
      | undefined;

    if (args.passwordAuth) {
      auth = {
        user: args.passwordAuth.user,
        pass: args.passwordAuth.pass,
      };
    } else if (args.oauth2Auth) {
      auth = {
        type: 'OAuth2',
        user: args.oauth2Auth.user,
        accessToken: args.oauth2Auth.accessToken,
      };
    }

    // Create transporter
    const transporter = nodemailer.createTransport({
      host: (args.smtpConfig as { host: string; port: number; secure: boolean })
        .host,
      port: (args.smtpConfig as { host: string; port: number; secure: boolean })
        .port,
      secure: (
        args.smtpConfig as { host: string; port: number; secure: boolean }
      ).secure,
      auth,
      connectionTimeout: 30000,
      greetingTimeout: 10000,
    } as nodemailer.TransportOptions);

    // Send email
    const info = await transporter.sendMail({
      from: args.from,
      to: args.to.join(', '),
      cc: args.cc?.join(', '),
      bcc: args.bcc?.join(', '),
      subject: args.subject,
      html: args.html,
      text: args.text,
      replyTo: args.replyTo,
      inReplyTo: args.inReplyTo,
      references: args.references?.join(' '),
      headers: args.headers,
    });

    transporter.close();

    debugLog('✓ Email sent successfully via SMTP', {
      messageId: info.messageId,
      from: args.from,
      to: args.to,
      subject: args.subject,
    });

    return {
      success: true,
      messageId: info.messageId,
    };
  },
});
