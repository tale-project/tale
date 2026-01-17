/**
 * Business logic for sending a conversation message via SMTP
 * and updating the message with the external message ID
 *
 * Includes automatic retry with exponential backoff:
 * - Retry 1: 30 seconds delay
 * - Retry 2: 60 seconds delay
 * - Retry 3: 120 seconds delay
 * After 3 failed retries, message is moved to 'failed' state
 */

import type { ActionCtx } from '../../_generated/server';
import { api, internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import {
  decryptAndRefreshOAuth2Token,
  decryptPasswordAuth,
} from './decrypt_and_refresh_oauth2';

import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_EMAIL', '[Email]');

// Retry configuration
const MAX_RETRIES = 3;
const BACKOFF_DELAYS_MS = [30000, 60000, 120000]; // 30s, 60s, 120s

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
    retryCount?: number; // Current retry attempt (0 = first attempt)
  },
): Promise<{ success: boolean; messageId: string }> {
  const retryCount = args.retryCount ?? 0;
  try {
    // Get email provider (use default if not specified)
    let provider: unknown;
    if (args.providerId) {
      provider = await ctx.runQuery(internal.email_providers.queries.get_internal.getInternal, {
        providerId: args.providerId,
      });
    } else {
      provider = await ctx.runQuery(
        internal.email_providers.queries.get_default_internal.getDefaultInternal,
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
          await ctx.runAction(internal.actions.oauth2.decryptStringInternal, {
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
          await ctx.runAction(internal.actions.oauth2.decryptStringInternal, {
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
          await ctx.runAction(api.email_providers.actions.store_oauth2_tokens.storeOAuth2Tokens, {
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
        internal.conversations.updateConversationMessageInternal,
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
        internal.email_providers.actions.send_message_via_smtp_internal.sendMessageViaSMTPInternal,
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
      internal.conversations.updateConversationMessageInternal,
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
