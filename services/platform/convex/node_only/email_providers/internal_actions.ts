'use node';

import { v } from 'convex/values';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';

import { internalAction } from '../../_generated/server';
import * as EmailProviders from '../../email_providers/helpers';

export const testConnection = internalAction({
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
        vendor: args.vendor,
        authMethod: args.authMethod,
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
