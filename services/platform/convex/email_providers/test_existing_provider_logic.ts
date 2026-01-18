/**
 * Main business logic for testing an existing email provider
 */

import type { ActionCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import type { ProviderForTesting, TestResult } from './test_existing_provider';
import { api } from '../_generated/api';
import {
  validateProviderForTesting,
  getOAuth2UserEmail,
  shouldProviderBeActive,
  generateWarnings,
} from './test_existing_provider';
import {
  decryptPasswordAuth,
  decryptAndRefreshOAuth2Token,
} from './decrypt_and_refresh_oauth2';

import { createDebugLog } from '../lib/debug_log';

const debugLog = createDebugLog('DEBUG_EMAIL', '[Email]');

interface TestExistingProviderDependencies {
  getProvider: (providerId: Doc<'emailProviders'>['_id']) => Promise<unknown>;
  updateStatus: (
    providerId: Doc<'emailProviders'>['_id'],
    status: 'testing' | 'active' | 'error',
    lastTestedAt?: number,
    errorMessage?: string,
  ) => Promise<void>;
  testConnection: (params: {
    vendor: string;
    authMethod: 'password' | 'oauth2';
    passwordAuth?: { user: string; pass: string };
    oauth2Auth?: { user: string; accessToken: string };
    smtpConfig: { host: string; port: number; secure: boolean };
    imapConfig: { host: string; port: number; secure: boolean };
  }) => Promise<TestResult>;
  decryptString: (jwe: string) => Promise<string>;
  refreshToken: (params: {
    provider: string;
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    scope?: string;
    accountType?: 'personal' | 'organizational' | 'both';
    tokenUrl?: string;
  }) => Promise<{
    accessToken: string;
    refreshToken?: string;
    tokenType: string;
    expiresIn?: number;
    scope?: string;
  }>;
  storeTokens: (params: {
    emailProviderId: Doc<'emailProviders'>['_id'];
    accessToken: string;
    refreshToken?: string;
    tokenType: string;
    expiresIn?: number;
    scope?: string;
  }) => Promise<null>;
  setMetadata: (
    providerId: Doc<'emailProviders'>['_id'],
    config: Record<string, string | number | boolean>,
  ) => Promise<void>;
}

/**
 * Main orchestration logic for testing an existing provider
 * This function contains all the business logic, making the action a thin wrapper
 */
export async function testExistingProviderLogic(
  ctx: ActionCtx,
  providerId: Doc<'emailProviders'>['_id'],
  deps: TestExistingProviderDependencies,
): Promise<TestResult> {
  // Get the provider
  const provider = await deps.getProvider(providerId);

  if (!provider) {
    throw new Error('Provider not found');
  }

  const providerData = provider as ProviderForTesting;

  // Validate provider configuration
  validateProviderForTesting(providerData);

  const accountType = providerData.metadata?.accountType as
    | 'personal'
    | 'organizational'
    | 'both'
    | undefined;

  // Decrypt credentials based on auth method
  let passwordAuth: { user: string; pass: string } | undefined;
  let oauth2Auth: { user: string; accessToken: string } | undefined;

  if (providerData.authMethod === 'password' && providerData.passwordAuth) {
    // Decrypt password using model function
    passwordAuth = await decryptPasswordAuth(
      providerData.passwordAuth,
      deps.decryptString,
    );
  } else if (providerData.authMethod === 'oauth2' && providerData.oauth2Auth) {
    // Decrypt and potentially refresh OAuth2 token (for Outlook/Gmail resources)
    const tokenResult = await decryptAndRefreshOAuth2Token(
      ctx,
      providerId,
      providerData.oauth2Auth,
      deps.decryptString,
      deps.refreshToken,
      deps.storeTokens,
    );

    // Resolve user email, persist in metadata if missing
    let userEmail: string;
    try {
      userEmail = getOAuth2UserEmail(providerData.metadata);
    } catch (_e) {
      // Try deriving the user email now
      let derivedEmail: string | null = null;
      try {
        if (
          providerData.oauth2Auth.provider === 'microsoft' &&
          providerData.oauth2Auth.refreshTokenEncrypted
        ) {
          // Decrypt refresh token and client secret to mint a Graph token
          const refreshToken = await deps.decryptString(
            providerData.oauth2Auth.refreshTokenEncrypted,
          );
          const clientSecret = await deps.decryptString(
            providerData.oauth2Auth.clientSecretEncrypted,
          );
          const graphTokens = await deps.refreshToken({
            provider: providerData.oauth2Auth.provider,
            clientId: providerData.oauth2Auth.clientId,
            clientSecret,
            refreshToken,
            scope: 'https://graph.microsoft.com/User.Read',
            accountType,
            tokenUrl: providerData.oauth2Auth.tokenUrl,
          });
          derivedEmail = await ctx.runAction(api.oauth2.getUserEmail, {
            provider: providerData.oauth2Auth.provider,
            accessToken: graphTokens.accessToken,
          });
        } else {
          // For other providers, try with the current resource token
          derivedEmail = await ctx.runAction(api.oauth2.getUserEmail, {
            provider: providerData.oauth2Auth.provider,
            accessToken: tokenResult.accessToken,
          });
        }
      } catch (innerErr) {
        console.warn(
          'Failed to derive OAuth2 user email during test:',
          innerErr,
        );
      }

      if (!derivedEmail) {
        throw new Error(
          'OAuth2 provider missing user email. Please re-authorize the provider.',
        );
      }

      userEmail = derivedEmail;
      // Persist to metadata for future runs
      await deps.setMetadata(providerId, {
        oauth2_user: userEmail,
        oauth2_user_updatedAt: new Date().toISOString(),
      });
    }

    oauth2Auth = {
      user: userEmail,
      accessToken: tokenResult.accessToken,
    };
  } else {
    throw new Error('Invalid authentication configuration');
  }

  // Update status to 'testing'
  await deps.updateStatus(providerId, 'testing');

  // Test the connection
  debugLog(`Testing connection for provider ${providerId}...`);

  const result = await deps.testConnection({
    vendor: providerData.vendor,
    authMethod: providerData.authMethod,
    passwordAuth,
    oauth2Auth,
    smtpConfig: providerData.smtpConfig!,
    imapConfig: providerData.imapConfig!,
  });

  // Log the result
  if (result.success) {
    debugLog(`✓ Connection test successful for provider ${providerId}`, {
      smtpLatency: result.smtp.latencyMs,
      imapLatency: result.imap.latencyMs,
    });
  } else {
    console.error(`✗ Connection test failed for provider ${providerId}`, {
      smtp: result.smtp.success ? 'OK' : `Failed: ${result.smtp.error}`,
      imap: result.imap.success ? 'OK' : `Failed: ${result.imap.error}`,
    });
  }

  // Update provider status based on test result
  const shouldBeActive = shouldProviderBeActive(
    result,
    providerData.authMethod,
  );
  const warnings = generateWarnings(result, providerData.authMethod);

  await deps.updateStatus(
    providerId,
    shouldBeActive ? 'active' : 'error',
    Date.now(),
    warnings.length > 0 ? warnings.join('; ') : undefined,
  );

  return result;
}
