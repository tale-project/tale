// 'use node';

/**
 * Email Providers API - Thin wrappers around model functions
 */

import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from './_generated/server';
import { v } from 'convex/values';
import { api, internal } from './_generated/api';
import { Id } from './_generated/dataModel';
import { queryWithRLS, mutationWithRLS } from './lib/rls';
import * as EmailProviders from './model/email_providers';
import { saveRelatedWorkflows } from './model/email_providers/save_related_workflows';

import { createDebugLog } from './lib/debug_log';

const debugLog = createDebugLog('DEBUG_OAUTH2', '[OAuth2]');

// ============================================================================
// Public Queries
// ============================================================================

/**
 * List all email providers for an organization
 */
export const list = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    return await EmailProviders.listProviders(ctx, args);
  },
});

// ============================================================================
// Public Mutations
// ============================================================================

/**
 * Set an email provider as the default for its organization
 */
export const setDefault = mutationWithRLS({
  args: {
    providerId: v.id('emailProviders'),
  },
  handler: async (ctx, args) => {
    return await EmailProviders.updateProvider(ctx, {
      providerId: args.providerId,
      isDefault: true,
    });
  },
});

/**
 * Delete an email provider
 */
export const deleteProvider = mutationWithRLS({
  args: {
    providerId: v.id('emailProviders'),
  },
  handler: async (ctx, args) => {
    return await EmailProviders.deleteProvider(ctx, args);
  },
});

// ============================================================================

// Internal Queries
// ============================================================================

/**
 * Internal query to get provider by ID (used by actions)
 */
export const getInternal = internalQuery({
  args: {
    providerId: v.id('emailProviders'),
  },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await EmailProviders.getProviderById(ctx, args);
  },
});

/**
 * Internal query to get default provider (used by actions and workflows)
 */
export const getDefaultInternal = internalQuery({
  args: {
    organizationId: v.string(),
  },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await EmailProviders.getDefaultProvider(ctx, args);
  },
});

// ============================================================================
// Internal Mutations
// ============================================================================

/**
 * Internal mutation to update provider status
 */
export const updateProviderStatusInternal = internalMutation({
  args: {
    providerId: v.id('emailProviders'),
    status: v.optional(EmailProviders.emailProviderStatusValidator),
    lastTestedAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await EmailProviders.updateProviderStatus(ctx, args);
  },
});

// ============================================================================
// Public Actions (with OAuth2 Integration)
// ============================================================================

/**
 * Test connection for an existing email provider
 * Decrypts credentials and tests the connection
 */
export const testExistingProvider = action({
  args: {
    providerId: v.id('emailProviders'),
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
  handler: async (ctx, args): Promise<EmailProviders.TestResult> => {
    return await EmailProviders.testExistingProviderLogic(
      ctx,
      args.providerId,
      {
        getProvider: async (providerId): Promise<unknown> =>
          await ctx.runQuery(internal.email_providers.getInternal, {
            providerId,
          }),
        updateStatus: async (
          providerId,
          status,
          lastTestedAt,
          errorMessage,
        ): Promise<void> => {
          await ctx.runMutation(
            internal.email_providers.updateProviderStatusInternal,
            { providerId, status, lastTestedAt, errorMessage },
          );
        },
        testConnection: async (params): Promise<EmailProviders.TestResult> =>
          await ctx.runAction(
            internal.node_only.email_providers.test_connection
              .testConnectionInternal,
            {
              vendor: params.vendor as
                | 'gmail'
                | 'outlook'
                | 'smtp'
                | 'resend'
                | 'other',
              authMethod: params.authMethod,
              passwordAuth: params.passwordAuth,
              oauth2Auth: params.oauth2Auth,
              smtpConfig: params.smtpConfig,
              imapConfig: params.imapConfig,
            },
          ),
        decryptString: async (encrypted): Promise<string> =>
          await ctx.runAction(internal.oauth2.decryptStringInternal, {
            encrypted,
          }),
        refreshToken: async (params) => {
          const result = await ctx.runAction(api.oauth2.refreshToken, params);
          return result as {
            accessToken: string;
            refreshToken?: string;
            tokenType: string;
            expiresIn?: number;
            scope?: string;
          };
        },
        storeTokens: async (params): Promise<null> =>
          await ctx.runAction(api.email_providers.storeOAuth2Tokens, params),
        setMetadata: async (
          providerId,
          config: Record<string, string | number | boolean>,
        ): Promise<void> => {
          await ctx.runMutation(
            internal.email_providers.updateMetadataInternal,
            {
              id: providerId,
              config,
            },
          );
        },
      },
    );
  },
});

/**
 * Test email provider connection BEFORE saving
 * Delegates to the testing module (Node.js runtime)
 */
export const testConnection = action({
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
  handler: async (ctx, args) => {
    // Delegate to Node.js action in node_only/email_providers
    const result: {
      success: boolean;
      smtp: { success: boolean; latencyMs: number; error?: string };
      imap: { success: boolean; latencyMs: number; error?: string };
    } = await ctx.runAction(
      internal.node_only.email_providers.test_connection.testConnectionInternal,
      args,
    );
    return result;
  },
});

/**
 * Create a new email provider with encryption for sensitive fields
 */
export const create = action({
  args: {
    organizationId: v.string(),
    name: v.string(),
    vendor: v.union(
      v.literal('gmail'),
      v.literal('outlook'),
      v.literal('smtp'),
      v.literal('resend'),
      v.literal('other'),
    ),
    authMethod: v.union(v.literal('password'), v.literal('oauth2')),
    sendMethod: v.optional(v.union(v.literal('smtp'), v.literal('api'))),
    passwordAuth: v.optional(
      v.object({
        user: v.string(),
        pass: v.string(),
      }),
    ),
    oauth2Auth: v.optional(
      v.object({
        provider: v.string(),
        clientId: v.string(),
        clientSecret: v.string(),
        tokenUrl: v.optional(v.string()),
      }),
    ),
    smtpConfig: v.optional(
      v.object({
        host: v.string(),
        port: v.number(),
        secure: v.boolean(),
      }),
    ),
    imapConfig: v.optional(
      v.object({
        host: v.string(),
        port: v.number(),
        secure: v.boolean(),
      }),
    ),
    isDefault: v.boolean(),
    metadata: v.optional(v.any()),
  },
  returns: v.id('emailProviders'),
  handler: async (ctx, args): Promise<Id<'emailProviders'>> => {
    return await EmailProviders.createProviderLogic(ctx, args, {
      encryptString: async (plaintext) =>
        await ctx.runAction(internal.oauth2.encryptStringInternal, {
          plaintext,
        }),
      createInternal: async (params) =>
        await ctx.runMutation(internal.email_providers.createInternal, {
          organizationId: params.organizationId,
          name: params.name,
          vendor: params.vendor as
            | 'gmail'
            | 'outlook'
            | 'smtp'
            | 'resend'
            | 'other',
          authMethod: params.authMethod as 'password' | 'oauth2',
          sendMethod: params.sendMethod,
          passwordAuth: params.passwordAuth,
          oauth2Auth: params.oauth2Auth,
          smtpConfig: params.smtpConfig,
          imapConfig: params.imapConfig,
          isDefault: params.isDefault,
          metadata: params.metadata,
        }),
    });
  },
});

/**
 * Create OAuth2 email provider with server-side credentials
 * Fetches OAuth2 credentials from environment variables
 */
export const createOAuth2Provider = action({
  args: {
    organizationId: v.string(),
    name: v.string(),
    vendor: v.union(v.literal('gmail'), v.literal('outlook')),
    provider: v.union(v.literal('gmail'), v.literal('microsoft')),
    sendMethod: v.optional(v.union(v.literal('smtp'), v.literal('api'))),
    smtpConfig: v.optional(
      v.object({
        host: v.string(),
        port: v.number(),
        secure: v.boolean(),
      }),
    ),
    imapConfig: v.optional(
      v.object({
        host: v.string(),
        port: v.number(),
        secure: v.boolean(),
      }),
    ),
    isDefault: v.boolean(),
    accountType: v.optional(
      v.union(
        v.literal('personal'),
        v.literal('organizational'),
        v.literal('both'),
      ),
    ),
  },
  returns: v.id('emailProviders'),
  handler: async (ctx, args): Promise<Id<'emailProviders'>> => {
    return await EmailProviders.createOAuth2ProviderLogic(ctx, args, {
      encryptString: async (plaintext) =>
        await ctx.runAction(internal.oauth2.encryptStringInternal, {
          plaintext,
        }),
      createInternal: async (params) =>
        await ctx.runMutation(internal.email_providers.createInternal, {
          organizationId: params.organizationId,
          name: params.name,
          vendor: params.vendor as
            | 'gmail'
            | 'outlook'
            | 'smtp'
            | 'resend'
            | 'other',
          authMethod: params.authMethod as 'password' | 'oauth2',
          sendMethod: params.sendMethod,
          oauth2Auth: params.oauth2Auth,
          smtpConfig: params.smtpConfig,
          imapConfig: params.imapConfig,
          isDefault: params.isDefault,
          metadata: params.metadata,
        }),
    });
  },
});

/**
 * Generate OAuth2 authorization URL for an email provider
 * Redirects user to the OAuth2 provider for authorization
 */
export const generateOAuth2AuthUrl = action({
  args: {
    emailProviderId: v.id('emailProviders'),
    organizationId: v.string(),
    redirectUri: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    return await EmailProviders.generateOAuth2AuthUrlLogic(ctx, args, {
      getProvider: async (providerId) =>
        await ctx.runQuery(internal.email_providers.getInternal, {
          providerId,
        }),
      setMetadata: async (
        providerId,
        config: Record<string, string | number | boolean>,
      ) => {
        await ctx.runMutation(internal.email_providers.updateMetadataInternal, {
          id: providerId,
          config,
        });
      },
    });
  },
});

/**
 * Handle complete OAuth2 callback flow with internal decryption
 * This action fetches the provider, decrypts credentials, exchanges code for tokens,
 * stores tokens, and optionally fetches user email - all in one call from Next.js
 */
export const handleOAuth2Callback = action({
  args: {
    emailProviderId: v.id('emailProviders'),
    code: v.string(),
    redirectUri: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    userEmail: v.optional(v.string()),
    redirectUri: v.optional(v.string()),
    redirectOrigin: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    success: boolean;
    userEmail?: string;
    redirectUri?: string;
    redirectOrigin?: string;
  }> => {
    // Fetch the provider
    const provider = await ctx.runQuery(internal.email_providers.getInternal, {
      providerId: args.emailProviderId,
    });

    if (!provider) {
      throw new Error('Email provider not found');
    }

    if (!provider.oauth2Auth) {
      throw new Error('OAuth2 configuration not found for this provider');
    }

    const { oauth2Auth } = provider;

    // Decrypt the client secret in Convex (where encryption happened)
    const clientSecret = await ctx.runAction(
      internal.oauth2.decryptStringInternal,
      {
        encrypted: oauth2Auth.clientSecretEncrypted,
      },
    );

    // Get metadata for account type
    const metadata = provider.metadata as Record<string, unknown> | undefined;
    const accountType = metadata?.accountType as
      | 'personal'
      | 'organizational'
      | 'both'
      | undefined;

    // Prefer the redirectUri we persisted when generating the auth URL
    const storedRedirectUri =
      (metadata?.redirectUri as string | undefined) ||
      (metadata?.oauth2_redirect_uri as string | undefined);
    const effectiveRedirectUri = storedRedirectUri || args.redirectUri;

    debugLog('Using redirectUri for token exchange', {
      storedRedirectUri,
      argsRedirectUri: args.redirectUri,
      effectiveRedirectUri,
    });

    // Exchange authorization code for tokens
    const tokens = await ctx.runAction(api.oauth2.exchangeCode, {
      code: args.code,
      provider: oauth2Auth.provider,
      clientId: oauth2Auth.clientId,
      clientSecret,
      redirectUri: effectiveRedirectUri,
      accountType,
    });

    // Store the tokens
    await ctx.runAction(api.email_providers.storeOAuth2Tokens, {
      emailProviderId: args.emailProviderId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenType: tokens.tokenType,
      expiresIn: tokens.expiresIn,
      scope: tokens.scope,
    });

    // Try to fetch user email (optional), do not swallow errors from workflow saving
    let userEmail: string | undefined;
    let email: string | null = null;
    try {
      if (oauth2Auth.provider === 'microsoft' && tokens.refreshToken) {
        // Obtain a Graph token using the refresh token so we can call /me
        const graphTokens = await ctx.runAction(api.oauth2.refreshToken, {
          provider: oauth2Auth.provider,
          clientId: oauth2Auth.clientId,
          clientSecret,
          refreshToken: tokens.refreshToken,
          scope: 'https://graph.microsoft.com/User.Read',
          accountType,
          tokenUrl: oauth2Auth.tokenUrl,
        });
        email = await ctx.runAction(api.oauth2.getUserEmail, {
          provider: oauth2Auth.provider,
          accessToken: graphTokens.accessToken,
        });
      } else {
        // Non-Microsoft providers (or no refresh token available)
        email = await ctx.runAction(api.oauth2.getUserEmail, {
          provider: oauth2Auth.provider,
          accessToken: tokens.accessToken,
        });
      }
    } catch (e) {
      console.warn('Unable to fetch OAuth2 user email', e);
    }

    if (email) {
      userEmail = email;
      // Store user email in provider metadata
      const updatedMetadata = {
        ...(metadata || {}),
        oauth2_user: email,
        oauth2_user_updatedAt: new Date().toISOString(),
      } as Record<string, string | number | boolean>;

      await ctx.runMutation(internal.email_providers.updateMetadataInternal, {
        id: args.emailProviderId,
        config: updatedMetadata,
      });
    }

    // Save related workflows for this email provider (only if IMAP is configured)
    if (provider.imapConfig && userEmail) {
      const workflowIds = await saveRelatedWorkflows(ctx, {
        organizationId: provider.organizationId,
        accountEmail: userEmail,
      });

      debugLog(`Saved ${workflowIds.length} related workflows`);
    }

    return {
      success: true,
      userEmail,
      redirectUri: effectiveRedirectUri,
      redirectOrigin: new URL(effectiveRedirectUri).origin,
    };
  },
});

/**
 * Store OAuth2 tokens for an email provider
 */
export const storeOAuth2Tokens = action({
  args: {
    emailProviderId: v.id('emailProviders'),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    tokenType: v.string(),
    expiresIn: v.optional(v.number()),
    scope: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    return await EmailProviders.storeOAuth2TokensLogic(ctx, args, {
      encryptString: async (plaintext): Promise<string> =>
        await ctx.runAction(internal.oauth2.encryptStringInternal, {
          plaintext,
        }),
      updateTokens: async (params): Promise<void> => {
        await ctx.runMutation(
          internal.email_providers.updateOAuth2Tokens,
          params,
        );
      },
    });
  },
});

/**
 * Update email provider metadata
 */
export const updateMetadata = action({
  args: {
    id: v.id('emailProviders'),
    config: v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.email_providers.updateMetadataInternal, {
      id: args.id,
      config: args.config,
    });
    return null;
  },
});

// ============================================================================
// Internal Mutations
// ============================================================================

/**
 * Internal mutation to create email provider
 */
export const createInternal = internalMutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    vendor: EmailProviders.emailProviderVendorValidator,
    authMethod: EmailProviders.emailProviderAuthMethodValidator,
    sendMethod: v.optional(v.union(v.literal('smtp'), v.literal('api'))),
    passwordAuth: v.optional(
      v.object({
        user: v.string(),
        passEncrypted: v.string(),
      }),
    ),
    oauth2Auth: v.optional(
      v.object({
        provider: v.string(),
        clientId: v.string(),
        clientSecretEncrypted: v.string(),
        accessTokenEncrypted: v.optional(v.string()),
        refreshTokenEncrypted: v.optional(v.string()),
        tokenExpiry: v.optional(v.number()),
        tokenUrl: v.optional(v.string()),
      }),
    ),
    smtpConfig: v.optional(EmailProviders.smtpConfigValidator),
    imapConfig: v.optional(EmailProviders.imapConfigValidator),
    isDefault: v.boolean(),
    metadata: v.optional(v.any()),
  },
  returns: v.id('emailProviders'),
  handler: async (ctx, args) => {
    return await EmailProviders.createProviderInternal(ctx, args);
  },
});

/**
 * Internal mutation to update OAuth2 tokens
 */
export const updateOAuth2Tokens = internalMutation({
  args: {
    emailProviderId: v.id('emailProviders'),
    accessTokenEncrypted: v.string(),
    refreshTokenEncrypted: v.optional(v.string()),
    tokenExpiry: v.optional(v.number()),
    tokenType: v.string(),
    scope: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await EmailProviders.updateOAuth2Tokens(ctx, args);
  },
});

/**
 * Internal mutation to update provider metadata
 */
export const updateMetadataInternal = internalMutation({
  args: {
    id: v.id('emailProviders'),
    config: v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await EmailProviders.updateMetadataInternal(ctx, args);
  },
});

/**
 * Internal action to send a conversation message via SMTP
 * Supports automatic retry with exponential backoff (30s, 60s, 120s)
 * After 3 failed retries, message is moved to 'failed' state
 */
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
    retryCount: v.optional(v.number()), // Current retry attempt (0 = first attempt)
  },
  returns: v.object({
    success: v.boolean(),
    messageId: v.string(),
  }),
  handler: async (ctx, args) => {
    return await EmailProviders.sendMessageViaSMTP(ctx, args);
  },
});

/**
 * Internal action to send a conversation message via API (Gmail API / Microsoft Graph)
 * Supports automatic retry with exponential backoff (30s, 60s, 120s)
 * After 3 failed retries, message is moved to 'failed' state
 */
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
    retryCount: v.optional(v.number()), // Current retry attempt (0 = first attempt)
  },
  returns: v.object({
    success: v.boolean(),
    messageId: v.string(),
  }),
  handler: async (ctx, args) => {
    return await EmailProviders.sendMessageViaAPI(ctx, args);
  },
});

// (updateProviderStatusInternal already defined above)
