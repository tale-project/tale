/**
 * Business logic for sending a conversation message via SMTP
 * and updating the message with the external message ID
 */

import type { ActionCtx } from '../../_generated/server';
import { api, internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import {
  decryptAndRefreshOAuth2Token,
  decryptPasswordAuth,
} from './decrypt_and_refresh_oauth2';

export async function sendMessageViaSMTP(
  ctx: ActionCtx,
  args: {
    messageId: Id<'conversationMessages'>;
    organizationId: string;
    providerId?: Id<'emailProviders'>;
    from: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    html?: string;
    text?: string;
    replyTo?: string;
    inReplyTo?: string;
    references?: string[];
    headers?: Record<string, string>;
  },
): Promise<{ success: boolean; messageId: string }> {
  try {
    // Get email provider (use default if not specified)
    let provider: unknown;
    if (args.providerId) {
      provider = await ctx.runQuery(internal.email_providers.getInternal, {
        providerId: args.providerId,
      });
    } else {
      provider = await ctx.runQuery(
        internal.email_providers.getDefaultInternal,
        {
          organizationId: args.organizationId,
        },
      );
    }

    if (!provider) {
      throw new Error('Email provider not found');
    }

    if (!(provider as { smtpConfig?: unknown }).smtpConfig) {
      throw new Error('Email provider missing SMTP configuration');
    }

    const typedProvider = provider as {
      _id: Id<'emailProviders'>;
      authMethod?: 'password' | 'oauth2';
      passwordAuth?: { user: string; passEncrypted: string };
      oauth2Auth?: {
        provider: string;
        clientId: string;
        clientSecretEncrypted: string;
        accessTokenEncrypted?: string;
        refreshTokenEncrypted?: string;
        tokenExpiry?: number;
      };
      smtpConfig: { host: string; port: number; secure: boolean };
      metadata?: Record<string, unknown>;
    };

    let result: { success: boolean; messageId: string };

    if (typedProvider.authMethod === 'password' && typedProvider.passwordAuth) {
      // Password authentication
      const passwordAuth = await decryptPasswordAuth(
        typedProvider.passwordAuth,
        async (encrypted) =>
          await ctx.runAction(internal.oauth2.decryptStringInternal, {
            encrypted,
          }),
      );

      result = await ctx.runAction(
        internal.node_only.smtp.send_email.sendEmail,
        {
          smtpConfig: typedProvider.smtpConfig,
          passwordAuth,
          from: args.from,
          to: args.to,
          cc: args.cc,
          bcc: args.bcc,
          subject: args.subject,
          html: args.html,
          text: args.text,
          replyTo: args.replyTo,
          inReplyTo: args.inReplyTo,
          references: args.references,
          headers: args.headers,
        },
      );
    } else if (
      typedProvider.authMethod === 'oauth2' &&
      typedProvider.oauth2Auth
    ) {
      // OAuth2 authentication (XOAUTH2)
      const { accessToken } = await decryptAndRefreshOAuth2Token(
        ctx,
        typedProvider._id,
        typedProvider.oauth2Auth,
        async (encrypted) =>
          await ctx.runAction(internal.oauth2.decryptStringInternal, {
            encrypted,
          }),
        async ({ provider, clientId, clientSecret, refreshToken, tokenUrl }) =>
          await ctx.runAction(api.oauth2.refreshToken, {
            provider,
            clientId,
            clientSecret,
            refreshToken,
            tokenUrl,
          }),
        async ({
          emailProviderId,
          accessToken,
          refreshToken,
          tokenType,
          expiresIn,
          scope,
        }) =>
          await ctx.runAction(api.email_providers.storeOAuth2Tokens, {
            emailProviderId,
            accessToken,
            refreshToken,
            tokenType,
            expiresIn,
            scope,
          }),
      );

      // Determine SMTP user email for XOAUTH2
      const metadata = (typedProvider.metadata || {}) as Record<
        string,
        unknown
      >;
      let userEmail = '';
      if (typeof metadata.oauth2_user === 'string' && metadata.oauth2_user) {
        userEmail = metadata.oauth2_user;
      } else {
        const match = args.from.match(/<?([^<>@\s]+@[^<>@\s]+)>?/);
        userEmail = match ? match[1] : args.from;
      }

      result = await ctx.runAction(
        internal.node_only.smtp.send_email.sendEmail,
        {
          smtpConfig: typedProvider.smtpConfig,
          oauth2Auth: {
            user: userEmail,
            accessToken,
          },
          from: args.from,
          to: args.to,
          cc: args.cc,
          bcc: args.bcc,
          subject: args.subject,
          html: args.html,
          text: args.text,
          replyTo: args.replyTo,
          inReplyTo: args.inReplyTo,
          references: args.references,
          headers: args.headers,
        },
      );
    } else {
      throw new Error(
        'Unsupported or missing authentication for SMTP provider',
      );
    }

    // Update the conversation message with the external message ID
    await ctx.runMutation(
      internal.conversations.updateConversationMessageInternal,
      {
        messageId: args.messageId,
        externalMessageId: result.messageId,
        deliveryState: 'sent',
        sentAt: Date.now(),
      },
    );

    console.log('✓ Message sent and updated', {
      messageId: args.messageId,
      externalMessageId: result.messageId,
    });

    return {
      success: true,
      messageId: result.messageId,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await ctx.runMutation(
      internal.conversations.updateConversationMessageInternal,
      {
        messageId: args.messageId,
        deliveryState: 'failed',
        metadata: { errorMessage },
      },
    );
    // Do not throw; return a failure response so scheduler doesn't error out
    return { success: false, messageId: '' };
  }
}
