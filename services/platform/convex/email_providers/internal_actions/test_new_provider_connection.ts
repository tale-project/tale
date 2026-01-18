'use node';

/**
 * Internal action to test new provider connection
 * Provides actual network I/O implementations for testing
 */

import { v } from 'convex/values';
import { internalAction } from '../../_generated/server';
import { testNewProviderConnectionLogic } from '../test_new_provider_connection_logic';
import {
  emailProviderVendorValidator,
  emailProviderAuthMethodValidator,
  smtpConfigValidator,
  imapConfigValidator,
} from '../validators';
import { connectionTestResultValidator } from '../validators';
import type {
  VerifySmtpConnectionParams,
  VerifyImapConnectionParams,
} from '../test_connection_types';

// SMTP verification using nodemailer
async function verifySmtpConnection(params: VerifySmtpConnectionParams): Promise<void> {
  const nodemailer = await import('nodemailer');

  const transporter = nodemailer.createTransport({
    host: params.smtpConfig.host,
    port: params.smtpConfig.port,
    secure: params.smtpConfig.secure,
    auth: params.auth,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });

  await transporter.verify();
  transporter.close();
}

// IMAP verification using imapflow
async function verifyImapConnection(params: VerifyImapConnectionParams): Promise<void> {
  const { ImapFlow } = await import('imapflow');

  const auth: { user: string; pass?: string; accessToken?: string } = {
    user: params.auth.user,
  };

  if (params.auth.pass) {
    auth.pass = params.auth.pass;
  } else if (params.auth.accessToken) {
    auth.accessToken = params.auth.accessToken;
  }

  const client = new ImapFlow({
    host: params.imapConfig.host,
    port: params.imapConfig.port,
    secure: params.imapConfig.secure,
    auth,
    logger: false,
  });

  await client.connect();
  await client.logout();
}

export const testNewProviderConnection = internalAction({
  args: {
    vendor: emailProviderVendorValidator,
    authMethod: emailProviderAuthMethodValidator,
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
    smtpConfig: smtpConfigValidator,
    imapConfig: imapConfigValidator,
  },
  returns: connectionTestResultValidator,
  handler: async (ctx, args) => {
    return await testNewProviderConnectionLogic(args, {
      verifySmtpConnection,
      verifyImapConnection,
    });
  },
});
