/**
 * Email Provider Action
 *
 * Fetches email provider configuration for use in workflows
 */

import { v } from 'convex/values';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import { api, internal } from '../../../_generated/api';
import type { Doc } from '../../../_generated/dataModel';
import { decryptAndRefreshOAuth2Token } from '../../../model/email_providers/decrypt_and_refresh_oauth2';

export const emailProviderAction: ActionDefinition<{
  operation: 'get_default' | 'get_imap_credentials';
  organizationId: string;
}> = {
  type: 'email_provider',
  title: 'Email Provider Operation',
  description:
    'Fetch email provider configuration (get_default, get_imap_credentials)',
  parametersValidator: v.object({
    operation: v.union(
      v.literal('get_default'),
      v.literal('get_imap_credentials'),
    ),
    organizationId: v.string(),
  }),

  async execute(ctx, params) {
    switch (params.operation) {
      case 'get_default': {
        if (!params.organizationId) {
          throw new Error(
            'get_default operation requires organizationId parameter',
          );
        }

        console.log(
          `[email_provider] Fetching default provider for organization: ${params.organizationId}`,
        );

        // Call internal query to get default provider (bypasses RLS)
        const provider = (await ctx.runQuery!(
          internal.email_providers.getDefaultInternal,
          {
            organizationId: params.organizationId,
          },
        )) as Doc<'emailProviders'> | null;

        console.log(
          `[email_provider] Provider found: ${provider ? provider._id : 'null'}`,
        );

        if (!provider) {
          console.error(
            `[email_provider] No default email provider found for organization ${params.organizationId}`,
          );
          throw new Error(
            `No default email provider found for organization ${params.organizationId}. Please create an email provider and set isDefault=true.`,
          );
        }

        // Return provider with encrypted password
        // The set_variables action will handle decryption when secure: true is set
        return {
          operation: 'get_default',
          provider: {
            _id: provider._id,
            name: provider.name,
            vendor: provider.vendor,
            authMethod: provider.authMethod,
            imapConfig: provider.imapConfig,
            smtpConfig: provider.smtpConfig,
            passwordAuth: provider.passwordAuth
              ? {
                  user: provider.passwordAuth.user,
                  passEncrypted: provider.passwordAuth.passEncrypted, // Keep encrypted
                }
              : undefined,
            isDefault: provider.isDefault,
            status: provider.status,
          },
          timestamp: Date.now(),
        };
      }

      case 'get_imap_credentials': {
        if (!params.organizationId) {
          throw new Error(
            'get_imap_credentials operation requires organizationId parameter',
          );
        }

        console.log(
          `[email_provider] Getting IMAP credentials for organization: ${params.organizationId}`,
        );

        // Get default provider
        const provider = (await ctx.runQuery!(
          internal.email_providers.getDefaultInternal,
          {
            organizationId: params.organizationId,
          },
        )) as Doc<'emailProviders'> | null;

        if (!provider) {
          throw new Error(
            `No default email provider found for organization ${params.organizationId}`,
          );
        }

        if (!provider.imapConfig) {
          throw new Error(
            `Email provider ${provider._id} does not have IMAP configuration`,
          );
        }

        // Handle based on auth method
        if (provider.authMethod === 'password') {
          if (!provider.passwordAuth) {
            throw new Error(
              `Email provider ${provider._id} is configured for password auth but passwordAuth is missing`,
            );
          }

          // Do NOT decrypt here. Return encrypted password for just-in-time decryption by the workflow engine.
          return {
            operation: 'get_imap_credentials',
            providerId: provider._id,
            credentials: {
              host: provider.imapConfig.host,
              port: provider.imapConfig.port,
              secure: provider.imapConfig.secure,
              username: provider.passwordAuth.user,
              passwordEncrypted: provider.passwordAuth.passEncrypted,
            },
            authMethod: 'password',
            timestamp: Date.now(),
          };
        } else if (provider.authMethod === 'oauth2') {
          if (!provider.oauth2Auth) {
            throw new Error(
              `Email provider ${provider._id} is configured for OAuth2 but oauth2Auth is missing`,
            );
          }

          // Get OAuth2 user email from metadata
          const oauth2User =
            (provider.metadata as Record<string, unknown>)?.oauth2_user ||
            provider.oauth2Auth.clientId;

          // Decrypt and refresh OAuth2 token
          const tokenResult = await decryptAndRefreshOAuth2Token(
            ctx,
            provider._id,
            provider.oauth2Auth,
            async (encrypted: string) =>
              await ctx.runAction!(internal.oauth2.decryptStringInternal, {
                encrypted,
              }),
            async (params) =>
              await ctx.runAction!(api.oauth2.refreshToken, params),
            async (params) =>
              await ctx.runAction!(
                api.email_providers.storeOAuth2Tokens,
                params,
              ),
          );

          console.log(
            `[email_provider] OAuth2 token ${tokenResult.wasRefreshed ? 'refreshed' : 'retrieved'} for provider ${provider._id}`,
          );

          // After potential refresh, read the latest encrypted token from DB
          const updatedProvider = (await ctx.runQuery!(
            internal.email_providers.getInternal,
            { providerId: provider._id },
          )) as Doc<'emailProviders'> | null;

          const accessTokenEncrypted =
            updatedProvider?.oauth2Auth?.accessTokenEncrypted ||
            provider.oauth2Auth.accessTokenEncrypted;

          return {
            operation: 'get_imap_credentials',
            providerId: provider._id,
            credentials: {
              host: provider.imapConfig.host,
              port: provider.imapConfig.port,
              secure: provider.imapConfig.secure,
              username: oauth2User as string,
              accessTokenEncrypted,
            },
            authMethod: 'oauth2',
            timestamp: Date.now(),
          };
        } else {
          throw new Error(
            `Unsupported auth method: ${provider.authMethod} for provider ${provider._id}`,
          );
        }
      }

      default:
        throw new Error(`Unknown operation: ${params.operation}`);
    }
  },
};
