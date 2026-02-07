'use node';

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { sendMessageViaAPI } from './send_message_via_api';
import { sendMessageViaSMTP } from './send_message_via_smtp';
import { testNewProviderConnectionLogic } from './test_new_provider_connection_logic';
import { storeOAuth2TokensLogic } from './store_oauth2_tokens_logic';
import { encryptString } from '../lib/crypto/encrypt_string';
import { decryptString } from '../lib/crypto/decrypt_string';
import {
  emailProviderVendorValidator,
  emailProviderAuthMethodValidator,
  smtpConfigValidator,
  imapConfigValidator,
  connectionTestResultValidator,
} from './validators';
import type {
  VerifySmtpConnectionParams,
  VerifyImapConnectionParams,
} from './test_connection_types';
import { saveRelatedWorkflows } from './save_related_workflows';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';

async function verifySmtpConnection(params: VerifySmtpConnectionParams): Promise<void> {
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

async function verifyImapConnection(params: VerifyImapConnectionParams): Promise<void> {
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

export const sendMessageViaAPIInternal = internalAction({
  args: {
    messageId: v.id('conversationMessages'),
    organizationId: v.string(),
    providerId: v.optional(v.id('emailProviders')),
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
    retryCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await sendMessageViaAPI(ctx, args);
  },
});

export const sendMessageViaSMTPInternal = internalAction({
  args: {
    messageId: v.id('conversationMessages'),
    organizationId: v.string(),
    providerId: v.optional(v.id('emailProviders')),
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
    retryCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await sendMessageViaSMTP(ctx, args);
  },
});

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

type OAuthProvider = 'gmail' | 'microsoft';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
  scope?: string;
}

type AccountType = 'personal' | 'organizational' | 'both';

function getTokenUrl(
  provider: OAuthProvider,
  accountType?: AccountType,
  tenantId?: string,
): string {
  if (provider === 'gmail') {
    return 'https://oauth2.googleapis.com/token';
  }
  // Microsoft: Use tenant ID if provided (for single-tenant apps), otherwise use account type
  let tenant = 'common';
  if (tenantId) {
    tenant = tenantId;
  } else if (accountType === 'personal') {
    tenant = 'consumers';
  } else if (accountType === 'organizational') {
    tenant = 'organizations';
  }
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
}

async function exchangeCodeForTokens(
  provider: OAuthProvider,
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  accountType?: AccountType,
  tenantId?: string,
): Promise<TokenResponse> {
  const tokenUrl = getTokenUrl(provider, accountType, tenantId);

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  // Microsoft requires a scope parameter, but can't have multiple resources in one request.
  // Use only Outlook scopes (single resource: outlook.office.com) during token exchange.
  // Graph API scopes will be requested separately using the refresh token if needed.
  if (provider === 'microsoft') {
    body.set(
      'scope',
      'https://outlook.office.com/SMTP.Send https://outlook.office.com/IMAP.AccessAsUser.All offline_access',
    );
  }

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[OAuth2 Callback] Token exchange failed:', {
      status: response.status,
      error: errorText,
    });
    throw new Error(`Token exchange failed: ${response.status} - ${errorText}`);
  }

  return (await response.json()) as TokenResponse;
}

/**
 * Handle OAuth2 callback - exchanges auth code for tokens and stores them
 */
export const handleOAuth2Callback = internalAction({
  args: {
    emailProviderId: v.id('emailProviders'),
    code: v.string(),
    redirectUri: v.string(),
  },
  handler: async (ctx, args) => {
    // Fetch the email provider to get OAuth config
    // Using explicit unknown type to avoid deep type instantiation issues
    const rawProvider: unknown = await ctx.runQuery(
      internal.email_providers.internal_queries.getInternal,
      { providerId: args.emailProviderId },
    );

    if (!rawProvider) {
      throw new Error('Email provider not found');
    }

    const emailProvider = rawProvider as {
      oauth2Auth?: {
        provider: string;
        clientId: string;
        clientSecretEncrypted: string;
      };
      metadata?: Record<string, unknown>;
    };

    if (!emailProvider.oauth2Auth) {
      throw new Error('OAuth2 configuration not found for this provider');
    }

    const { oauth2Auth } = emailProvider;
    const provider = oauth2Auth.provider as OAuthProvider;

    // Get account type and tenant ID from metadata (used for Microsoft tenant-specific endpoints)
    const accountType = emailProvider.metadata?.accountType as
      | AccountType
      | undefined;
    const tenantId = emailProvider.metadata?.tenantId as string | undefined;

    console.log('[OAuth2 Callback] Provider info:', {
      provider,
      accountType,
      tenantId,
      metadata: emailProvider.metadata,
      tokenUrl: getTokenUrl(provider, accountType, tenantId),
    });

    // Decrypt client secret
    const clientSecret = await decryptString(oauth2Auth.clientSecretEncrypted);

    // Exchange authorization code for tokens
    const tokens = await exchangeCodeForTokens(
      provider,
      args.code,
      oauth2Auth.clientId,
      clientSecret,
      args.redirectUri,
      accountType,
      tenantId,
    );

    // Encrypt tokens for storage
    const accessTokenEncrypted = await encryptString(tokens.access_token);
    const refreshTokenEncrypted = tokens.refresh_token
      ? await encryptString(tokens.refresh_token)
      : undefined;

    // Calculate token expiry timestamp
    const tokenExpiry = tokens.expires_in
      ? Math.floor(Date.now() / 1000) + tokens.expires_in
      : undefined;

    // Get the tenant-specific token URL to store for future token refreshes
    const tokenUrl = getTokenUrl(provider, accountType, tenantId);

    // Store encrypted tokens
    await ctx.runMutation(
      internal.email_providers.internal_mutations.updateOAuth2Tokens,
      {
        emailProviderId: args.emailProviderId,
        accessTokenEncrypted,
        refreshTokenEncrypted,
        tokenExpiry,
        tokenType: tokens.token_type,
        scope: tokens.scope,
        tokenUrl,
      },
    );

    // Update provider status to active
    await ctx.runMutation(
      internal.email_providers.internal_mutations.updateProviderStatus,
      {
        providerId: args.emailProviderId,
        status: 'active',
        lastTestedAt: Date.now(),
      },
    );

    // Get provider details for organizationId and check if IMAP is configured
    const providerForWorkflow = (await ctx.runQuery(
      internal.email_providers.internal_queries.getInternal,
      { providerId: args.emailProviderId },
    )) as { organizationId: string; imapConfig?: unknown } | null;

    // Create email sync workflows if IMAP is configured
    if (providerForWorkflow?.imapConfig) {
      await saveRelatedWorkflows(ctx, {
        organizationId: providerForWorkflow.organizationId,
        accountEmail: '',
      });
      console.log('[OAuth2 Callback] Created email sync workflows for provider:', {
        emailProviderId: args.emailProviderId,
        organizationId: providerForWorkflow.organizationId,
      });
    }

    console.log('[OAuth2 Callback] Successfully stored tokens for provider:', {
      emailProviderId: args.emailProviderId,
      provider,
      hasRefreshToken: !!tokens.refresh_token,
    });

    return { success: true };
  },
});

export const storeOAuth2TokensInternal = internalAction({
  args: {
    emailProviderId: v.id('emailProviders'),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    tokenType: v.string(),
    expiresIn: v.optional(v.number()),
    scope: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await storeOAuth2TokensLogic(args, {
      encryptString,
      updateTokens: async (params) => {
        await ctx.runMutation(
          internal.email_providers.internal_mutations.updateOAuth2Tokens,
          params,
        );
      },
    });
  },
});
