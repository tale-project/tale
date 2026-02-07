/**
 * Business logic for sending a conversation message via API (Gmail API / Microsoft Graph)
 * and updating the message with the external message ID
 *
 * Includes automatic retry with exponential backoff:
 * - Retry 1: 30 seconds delay
 * - Retry 2: 60 seconds delay
 * - Retry 3: 120 seconds delay
 * After 3 failed retries, message is moved to 'failed' state
 */

import type { ActionCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { decryptAndRefreshOAuth2Token } from './decrypt_and_refresh_oauth2';

import { createDebugLog } from '../lib/debug_log';

const debugLog = createDebugLog('DEBUG_EMAIL', '[Email]');

// Retry configuration
const MAX_RETRIES = 3;
const BACKOFF_DELAYS_MS = [30000, 60000, 120000]; // 30s, 60s, 120s

export async function sendMessageViaAPI(
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
    retryCount?: number; // Current retry attempt (0 = first attempt)
  },
): Promise<{ success: boolean; messageId: string }> {
  const retryCount = args.retryCount ?? 0;
  try {
    // Get email provider (use default if not specified)
    let provider: unknown;
    if (args.providerId) {
      provider = await ctx.runQuery(internal.email_providers.internal_queries.getInternal, {
        providerId: args.providerId,
      });
    } else {
      provider = await ctx.runQuery(
        internal.email_providers.internal_queries.getDefaultInternal,
        {
          organizationId: args.organizationId,
        },
      );
    }

    if (!provider) {
      throw new Error('Email provider not found');
    }

    const typedProvider = provider as {
      _id: Id<'emailProviders'>;
      vendor: 'gmail' | 'outlook' | 'smtp' | 'resend' | 'other';
      authMethod?: 'password' | 'oauth2';
      oauth2Auth?: {
        provider: string;
        clientId: string;
        clientSecretEncrypted: string;
        accessTokenEncrypted?: string;
        refreshTokenEncrypted?: string;
        tokenExpiry?: number;
        tokenUrl?: string;
      };
      metadata?: Record<string, unknown>;
    };

    // API sending requires OAuth2
    if (typedProvider.authMethod !== 'oauth2' || !typedProvider.oauth2Auth) {
      throw new Error('API sending requires OAuth2 authentication');
    }

    // Get and refresh OAuth2 token for the provider's native resource (Outlook/Gmail)
    const { accessToken } = await decryptAndRefreshOAuth2Token(
      ctx,
      typedProvider._id,
      typedProvider.oauth2Auth,
      async (jwe) =>
        await ctx.runAction(internal.lib.crypto.actions.decryptStringInternal, {
          jwe,
        }),
      async ({ provider, clientId, clientSecret, refreshToken, tokenUrl }) =>
        await ctx.runAction(internal.oauth2.refreshToken, {
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
        await ctx.runAction(internal.email_providers.internal_actions.storeOAuth2TokensInternal, {
          emailProviderId,
          accessToken,
          refreshToken,
          tokenType,
          expiresIn,
          scope,
        }),
    );

    let result: { success: boolean; messageId: string };

    // Send via appropriate API based on provider
    if (
      typedProvider.oauth2Auth.provider === 'gmail' ||
      typedProvider.vendor === 'gmail'
    ) {
      // Send via Gmail API
      const gmailResult = await ctx.runAction(
        internal.node_only.gmail.send_email.sendEmail,
        {
          accessToken,
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

      result = {
        success: gmailResult.success,
        messageId: gmailResult.messageId,
      };

      debugLog('✓ Message sent via Gmail API', {
        messageId: args.messageId,
        gmailMessageId: gmailResult.gmailMessageId,
        internetMessageId: gmailResult.messageId,
      });
    } else if (
      typedProvider.oauth2Auth.provider === 'microsoft' ||
      typedProvider.vendor === 'outlook'
    ) {
      // Send via Microsoft Graph API
      // Important: Microsoft Graph requires a token with audience graph.microsoft.com.
      // Our stored token may be for outlook.office.com from the Outlook scopes used for IMAP/SMTP.
      // Use the refresh token to mint a Graph-scoped access token just-in-time without storing it.
      // For Microsoft Graph we require a Graph-scoped access token (audience graph.microsoft.com)
      if (
        !typedProvider.oauth2Auth.refreshTokenEncrypted ||
        !typedProvider.oauth2Auth.clientSecretEncrypted
      ) {
        throw new Error(
          'Missing OAuth2 client secret or refresh token for Microsoft Graph send. Please re-authorize the provider.',
        );
      }

      const clientSecret = await ctx.runAction(
        internal.lib.crypto.actions.decryptStringInternal,
        {
          jwe: typedProvider.oauth2Auth.clientSecretEncrypted,
        },
      );
      const refreshToken = await ctx.runAction(
        internal.lib.crypto.actions.decryptStringInternal,
        {
          jwe: typedProvider.oauth2Auth.refreshTokenEncrypted,
        },
      );

      const { accessToken: graphAccessToken } = await ctx.runAction(
        internal.oauth2.refreshToken,
        {
          provider: typedProvider.oauth2Auth.provider,
          clientId: typedProvider.oauth2Auth.clientId,
          clientSecret,
          refreshToken,
          scope:
            'https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send',
          tokenUrl: typedProvider.oauth2Auth.tokenUrl,
        },
      );

      const graphResult = await ctx.runAction(
        internal.node_only.microsoft_graph.send_email.sendEmail,
        {
          accessToken: graphAccessToken,
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

      result = {
        success: graphResult.success,
        messageId: graphResult.messageId,
      };

      debugLog('✓ Message sent via Microsoft Graph API', {
        messageId: args.messageId,
        graphMessageId: graphResult.graphMessageId,
        internetMessageId: graphResult.messageId,
      });
    } else {
      throw new Error(
        `Unsupported provider for API sending: ${typedProvider.oauth2Auth.provider}`,
      );
    }

    // Update the conversation message with the external message ID
    await ctx.runMutation(
      internal.conversations.mutations.updateConversationMessageInternal,
      {
        messageId: args.messageId,
        externalMessageId: result.messageId,
        deliveryState: 'sent',
        sentAt: Date.now(),
      },
    );

    debugLog('✓ Message sent and updated', {
      messageId: args.messageId,
      externalMessageId: result.messageId,
    });

    return {
      success: true,
      messageId: result.messageId,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Check if we should retry
    if (retryCount < MAX_RETRIES) {
      const nextRetryCount = retryCount + 1;
      const delayMs =
        BACKOFF_DELAYS_MS[retryCount] ??
        BACKOFF_DELAYS_MS[BACKOFF_DELAYS_MS.length - 1];

      debugLog(
        `⚠ Message send failed, scheduling retry ${nextRetryCount}/${MAX_RETRIES} in ${delayMs / 1000}s`,
        {
          messageId: args.messageId,
          error: errorMessage,
          retryCount: nextRetryCount,
        },
      );

      // Update message with retry info (stays in 'queued' state)
      await ctx.runMutation(
        internal.conversations.mutations.updateConversationMessageInternal,
        {
          messageId: args.messageId,
          retryCount: nextRetryCount,
          metadata: {
            lastError: errorMessage,
            nextRetryAt: Date.now() + delayMs,
          },
        },
      );

      // Schedule retry with exponential backoff
      await ctx.scheduler.runAfter(
        delayMs,
        internal.email_providers.internal_actions.sendMessageViaAPIInternal,
        {
          messageId: args.messageId,
          organizationId: args.organizationId,
          providerId: args.providerId,
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
          retryCount: nextRetryCount,
        },
      );

      return { success: false, messageId: '' };
    }

    // Max retries exceeded - move to dead letter queue
    debugLog('✗ Message send failed permanently', {
      messageId: args.messageId,
      error: errorMessage,
      totalAttempts: retryCount + 1,
    });

    await ctx.runMutation(
      internal.conversations.mutations.updateConversationMessageInternal,
      {
        messageId: args.messageId,
        deliveryState: 'failed',
        retryCount: retryCount,
        metadata: {
          lastError: errorMessage,
          failedAt: Date.now(),
        },
      },
    );

    // Do not throw; return a failure response so scheduler doesn't error out
    return { success: false, messageId: '' };
  }
}
