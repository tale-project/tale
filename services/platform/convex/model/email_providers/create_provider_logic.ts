/**
 * Business logic for creating a new email provider
 */

import type { ActionCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';
import { saveRelatedWorkflows } from './save_related_workflows';

import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_EMAIL', '[Email]');

interface CreateProviderArgs {
  organizationId: string;
  name: string;
  vendor: 'gmail' | 'outlook' | 'smtp' | 'resend' | 'other';
  authMethod: 'password' | 'oauth2';
  sendMethod?: 'smtp' | 'api';
  passwordAuth?: {
    user: string;
    pass: string;
  };
  oauth2Auth?: {
    provider: string;
    clientId: string;
    clientSecret: string;
    tokenUrl?: string;
  };
  smtpConfig?: {
    host: string;
    port: number;
    secure: boolean;
  };
  imapConfig?: {
    host: string;
    port: number;
    secure: boolean;
  };
  isDefault: boolean;
  metadata?: unknown;
}

interface CreateProviderDependencies {
  encryptString: (plaintext: string) => Promise<string>;
  createInternal: (params: {
    organizationId: string;
    name: string;
    vendor: string;
    authMethod: string;
    sendMethod?: 'smtp' | 'api';
    passwordAuth?: {
      user: string;
      passEncrypted: string;
    };
    oauth2Auth?: {
      provider: string;
      clientId: string;
      clientSecretEncrypted: string;
      tokenUrl?: string;
    };
    smtpConfig?: {
      host: string;
      port: number;
      secure: boolean;
    };
    imapConfig?: {
      host: string;
      port: number;
      secure: boolean;
    };
    isDefault: boolean;
    metadata?: unknown;
  }) => Promise<Doc<'emailProviders'>['_id']>;
}

/**
 * Main logic for creating a new email provider
 * Handles encryption of sensitive credentials
 */
export async function createProviderLogic(
  ctx: ActionCtx,
  args: CreateProviderArgs,
  deps: CreateProviderDependencies,
): Promise<Doc<'emailProviders'>['_id']> {
  // Encrypt password if provided
  let passwordAuth = undefined;
  if (args.passwordAuth) {
    let passEncrypted: string;
    try {
      passEncrypted = await deps.encryptString(args.passwordAuth.pass);
    } catch (error) {
      console.error('Failed to encrypt password:', error);
      throw new Error(
        'Failed to encrypt password. Please ensure ENCRYPTION_SECRET is set in your Convex environment variables (Dashboard → Settings → Environment Variables). Error: ' +
          (error instanceof Error ? error.message : 'Unknown error'),
      );
    }
    passwordAuth = {
      user: args.passwordAuth.user,
      passEncrypted,
    };
  }

  // Encrypt OAuth2 credentials if provided
  let oauth2Auth = undefined;
  if (args.oauth2Auth) {
    let clientSecretEncrypted: string;
    try {
      clientSecretEncrypted = await deps.encryptString(
        args.oauth2Auth.clientSecret,
      );
    } catch (error) {
      console.error('Failed to encrypt OAuth2 client secret:', error);
      throw new Error(
        'Failed to encrypt OAuth2 credentials. Please ensure ENCRYPTION_SECRET is set in your Convex environment variables (Dashboard → Settings → Environment Variables). Error: ' +
          (error instanceof Error ? error.message : 'Unknown error'),
      );
    }
    oauth2Auth = {
      provider: args.oauth2Auth.provider,
      clientId: args.oauth2Auth.clientId,
      clientSecretEncrypted,
      tokenUrl: args.oauth2Auth.tokenUrl,
    };
  }

  // Call internal mutation to insert the provider
  const providerId = await deps.createInternal({
    organizationId: args.organizationId,
    name: args.name,
    vendor: args.vendor,
    authMethod: args.authMethod,
    sendMethod: args.sendMethod,
    passwordAuth,
    oauth2Auth,
    smtpConfig: args.smtpConfig,
    imapConfig: args.imapConfig,
    isDefault: args.isDefault,
    metadata: args.metadata,
  });

  // Save related workflows for this email provider (only if IMAP is configured)
  if (args.imapConfig && args.passwordAuth) {
    const workflowIds = await saveRelatedWorkflows(ctx, {
      organizationId: args.organizationId,
      accountEmail: args.passwordAuth.user,
    });

    debugLog(
      `Email Provider Create Saved ${workflowIds.length} related workflows`,
    );
  }

  return providerId;
}
