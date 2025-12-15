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

import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_EMAIL', '[Email]');

// Type for email provider operation params (discriminated union)
type EmailProviderActionParams =
  | { operation: 'get_default' }
  | { operation: 'get_imap_credentials' };

export const emailProviderAction: ActionDefinition<EmailProviderActionParams> =
  {
    type: 'email_provider',
    title: 'Email Provider Operation',
    description:
      'Fetch email provider configuration (get_default, get_imap_credentials). organizationId is automatically read from workflow context variables.',
    parametersValidator: v.union(
      // get_default: Get the default email provider
      v.object({
        operation: v.literal('get_default'),
      }),
      // get_imap_credentials: Get IMAP credentials for the default provider
      v.object({
        operation: v.literal('get_imap_credentials'),
      }),
    ),

  async execute(ctx, params, variables) {
    // Read organizationId from workflow context variables with proper type validation
    const organizationId = variables.organizationId;
    if (typeof organizationId !== 'string' || !organizationId) {
      throw new Error(
        'email_provider requires a non-empty string organizationId in workflow context',
      );
    }

    switch (params.operation) {
      case 'get_default': {
        debugLog(
          `email_provider Fetching default provider for organization: ${organizationId}`,
        );

        // Call internal query to get default provider (bypasses RLS)
        const provider = (await ctx.runQuery!(
          internal.email_providers.getDefaultInternal,
          {
            organizationId,
          },
        )) as Doc<'emailProviders'> | null;

        debugLog(
          `email_provider Provider found: ${provider ? provider._id : 'null'}`,
        );

        if (!provider) {
          console.error(
            `[email_provider] No default email provider found for organization ${organizationId}`,
          );
          throw new Error(
            `No default email provider found for organization ${organizationId}. Please create an email provider and set isDefault=true.`,
          );
        }

        // Return provider with encrypted password
        // The set_variables action will handle decryption when secure: true is set
        // Note: execute_action_node wraps this in output: { type: 'action', data: result }
        return {
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
        };
      }

      case 'get_imap_credentials': {
        debugLog(
          `email_provider Getting IMAP credentials for organization: ${organizationId}`,
        );

        // Get default provider
        const provider = (await ctx.runQuery!(
          internal.email_providers.getDefaultInternal,
          {
            organizationId,
          },
        )) as Doc<'emailProviders'> | null;

        if (!provider) {
          throw new Error(
            `No default email provider found for organization ${organizationId}`,
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
          // Note: execute_action_node wraps this in output: { type: 'action', data: result }
          return {
            providerId: provider._id,
            credentials: {
              host: provider.imapConfig.host,
              port: provider.imapConfig.port,
              secure: provider.imapConfig.secure,
              username: provider.passwordAuth.user,
              passwordEncrypted: provider.passwordAuth.passEncrypted,
            },
            authMethod: 'password',
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

          debugLog(
            `email_provider OAuth2 token ${tokenResult.wasRefreshed ? 'refreshed' : 'retrieved'} for provider ${provider._id}`,
          );

          // After potential refresh, read the latest encrypted token from DB
          const updatedProvider = (await ctx.runQuery!(
            internal.email_providers.getInternal,
            { providerId: provider._id },
          )) as Doc<'emailProviders'> | null;

          const accessTokenEncrypted =
            updatedProvider?.oauth2Auth?.accessTokenEncrypted ||
            provider.oauth2Auth.accessTokenEncrypted;

          // Note: execute_action_node wraps this in output: { type: 'action', data: result }
          return {
            providerId: provider._id,
            credentials: {
              host: provider.imapConfig.host,
              port: provider.imapConfig.port,
              secure: provider.imapConfig.secure,
              username: oauth2User as string,
              accessTokenEncrypted,
            },
            authMethod: 'oauth2',
          };
        } else {
          throw new Error(
            `Unsupported auth method: ${provider.authMethod} for provider ${provider._id}`,
          );
        }
      }

      default:
        throw new Error(
          `Unknown operation: ${(params as { operation: string }).operation}`,
        );
    }
  },
};
