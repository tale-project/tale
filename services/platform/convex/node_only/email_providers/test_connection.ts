'use node';

import { internalAction } from '../../_generated/server';
import { v } from 'convex/values';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import * as EmailProviders from '../../model/email_providers';

/**
 * Internal action to test email provider connection (Node.js runtime)
 * Thin wrapper delegating to model/email_providers logic.
 */
export const testConnectionInternal = internalAction({
  args: {
    vendor: v.union(
      v.literal('gmail'),
      v.literal('outlook'),
      v.literal('smtp'),
      v.literal('resend'),
      v.literal('other'),
    ),
    authMethod: v.union(v.literal('password'), v.literal('oauth2')),
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
    smtpConfig: v.object({
      host: v.string(),
      port: v.number(),
      secure: v.boolean(),
    }),
    imapConfig: v.object({
      host: v.string(),
      port: v.number(),
      secure: v.boolean(),
    }),
  },
  returns: v.object({
    success: v.boolean(),
    smtp: v.object({
      success: v.boolean(),
      latencyMs: v.number(),
      error: v.optional(v.string()),
    }),
    imap: v.object({
      success: v.boolean(),
      latencyMs: v.number(),
      error: v.optional(v.string()),
    }),
  }),
  handler: async (_ctx, args) => {
    const deps: EmailProviders.TestConnectionDeps = {
      verifySmtpConnection: async ({ smtpConfig, auth }) => {
        const transporter = nodemailer.createTransport({
          host: smtpConfig.host,
          port: smtpConfig.port,
          secure: smtpConfig.secure,
          auth,
          // Add timeout to prevent hanging
          connectionTimeout: 10000,
          greetingTimeout: 5000,
        });

        try {
          await transporter.verify();
        } finally {
          transporter.close();
        }
      },
      verifyImapConnection: async ({ imapConfig, auth }) => {
        const client = new ImapFlow({
          host: imapConfig.host,
          port: imapConfig.port,
          secure: imapConfig.secure,
          auth,
          // Disable verbose logging
          logger: false,
        });

        try {
          await client.connect();
        } finally {
          await client.logout();
        }
      },
    };

    const result = await EmailProviders.testNewProviderConnectionLogic(
      {
        vendor: args.vendor as EmailProviders.EmailProviderVendor,
        authMethod: args.authMethod as EmailProviders.EmailProviderAuthMethod,
        passwordAuth: args.passwordAuth ?? undefined,
        oauth2Auth: args.oauth2Auth ?? undefined,
        smtpConfig: args.smtpConfig,
        imapConfig: args.imapConfig,
      },
      deps,
    );

    return result;
  },
});
