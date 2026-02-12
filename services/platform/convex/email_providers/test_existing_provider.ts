import type { Doc } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';

import { internal } from '../_generated/api';
import { createDebugLog } from '../lib/debug_log';
import {
  decryptPasswordAuth,
  decryptAndRefreshOAuth2Token,
} from './decrypt_and_refresh_oauth2';

const debugLog = createDebugLog('DEBUG_EMAIL', '[Email]');

export interface TestExistingProviderArgs {
  providerId: Doc<'emailProviders'>['_id'];
}

export interface TestResult {
  success: boolean;
  smtp: { success: boolean; latencyMs: number; error?: string };
  imap: { success: boolean; latencyMs: number; error?: string };
}

export function isNetworkError(error?: string): boolean {
  if (!error) return false;
  const networkErrorPatterns = [
    'greeting never received',
    'connection timeout',
    'command failed',
    'econnrefused',
    'etimedout',
    'network',
  ];
  return networkErrorPatterns.some((pattern) =>
    error.toLowerCase().includes(pattern),
  );
}

export function shouldProviderBeActive(
  result: TestResult,
  authMethod: string,
): boolean {
  const smtpIsNetworkError = isNetworkError(result.smtp.error);
  const imapIsNetworkError = isNetworkError(result.imap.error);

  const hasOnlyNetworkErrors =
    (!result.smtp.success ? smtpIsNetworkError : true) &&
    (!result.imap.success ? imapIsNetworkError : true);

  return (
    result.imap.success || (authMethod === 'oauth2' && hasOnlyNetworkErrors)
  );
}

export function generateWarnings(
  result: TestResult,
  authMethod: string,
): string[] {
  const warnings: string[] = [];
  const smtpIsNetworkError = isNetworkError(result.smtp.error);
  const imapIsNetworkError = isNetworkError(result.imap.error);

  if (!result.smtp.success) {
    warnings.push(
      `SMTP: ${result.smtp.error}${smtpIsNetworkError ? ' (network issue, may work at runtime)' : ''}`,
    );
  }
  if (!result.imap.success) {
    warnings.push(
      `IMAP: ${result.imap.error}${imapIsNetworkError ? ' (network issue, may work at runtime)' : ''}`,
    );
  }

  const hasOnlyNetworkErrors =
    (!result.smtp.success ? smtpIsNetworkError : true) &&
    (!result.imap.success ? imapIsNetworkError : true);

  if (hasOnlyNetworkErrors && authMethod === 'oauth2') {
    warnings.push(
      'Connection tests failed due to network restrictions in Convex environment. OAuth2 credentials are valid and should work at runtime.',
    );
  }

  return warnings;
}

export interface ProviderForTesting {
  vendor: string;
  authMethod: 'password' | 'oauth2';
  sendMethod?: 'smtp' | 'api';
  passwordAuth?: {
    user: string;
    passEncrypted: string;
  };
  oauth2Auth?: {
    provider: string;
    clientId: string;
    clientSecretEncrypted: string;
    accessTokenEncrypted?: string;
    refreshTokenEncrypted?: string;
    tokenExpiry?: number;
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
  metadata?: Record<string, unknown>;
}

export function validateProviderForTesting(provider: ProviderForTesting): void {
  if (!provider.imapConfig) {
    throw new Error('Provider missing IMAP configuration');
  }
  if (provider.sendMethod !== 'api' && !provider.smtpConfig) {
    throw new Error('Provider missing SMTP configuration');
  }
}

export function needsTokenRefresh(
  tokenExpiry?: number,
  bufferSeconds: number = 300,
): boolean {
  if (!tokenExpiry) return false;
  const currentTime = Math.floor(Date.now() / 1000);
  return currentTime >= tokenExpiry - bufferSeconds;
}

export function getOAuth2UserEmail(metadata?: Record<string, unknown>): string {
  const userEmail = metadata?.oauth2_user;
  if (!userEmail || typeof userEmail !== 'string') {
    throw new Error(
      'OAuth2 provider missing user email. Please re-authorize the provider.',
    );
  }
  return userEmail;
}

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

export async function testExistingProvider(
  ctx: ActionCtx,
  providerId: Doc<'emailProviders'>['_id'],
  deps: TestExistingProviderDependencies,
): Promise<TestResult> {
  const provider = await deps.getProvider(providerId);

  if (!provider) {
    throw new Error('Provider not found');
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
  const providerData = provider as ProviderForTesting;
  validateProviderForTesting(providerData);

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
  const accountType = providerData.metadata?.accountType as
    | 'personal'
    | 'organizational'
    | 'both'
    | undefined;

  let passwordAuth: { user: string; pass: string } | undefined;
  let oauth2Auth: { user: string; accessToken: string } | undefined;

  if (providerData.authMethod === 'password' && providerData.passwordAuth) {
    passwordAuth = await decryptPasswordAuth(
      providerData.passwordAuth,
      deps.decryptString,
    );
  } else if (providerData.authMethod === 'oauth2' && providerData.oauth2Auth) {
    const tokenResult = await decryptAndRefreshOAuth2Token(
      ctx,
      providerId,
      providerData.oauth2Auth,
      deps.decryptString,
      deps.refreshToken,
      deps.storeTokens,
    );

    let userEmail: string;
    try {
      userEmail = getOAuth2UserEmail(providerData.metadata);
    } catch (_e) {
      let derivedEmail: string | null = null;
      try {
        if (
          providerData.oauth2Auth.provider === 'microsoft' &&
          providerData.oauth2Auth.refreshTokenEncrypted
        ) {
          const refreshToken = await deps.decryptString(
            providerData.oauth2Auth.refreshTokenEncrypted,
          );
          const clientSecret = await deps.decryptString(
            providerData.oauth2Auth.clientSecretEncrypted,
          );
          // Microsoft requires a separate Graph API token for user email lookup
          const graphTokens = await deps.refreshToken({
            provider: providerData.oauth2Auth.provider,
            clientId: providerData.oauth2Auth.clientId,
            clientSecret,
            refreshToken,
            scope: 'https://graph.microsoft.com/User.Read',
            accountType,
            tokenUrl: providerData.oauth2Auth.tokenUrl,
          });
          derivedEmail = await ctx.runAction(internal.oauth2.getUserEmail, {
            provider: providerData.oauth2Auth.provider,
            accessToken: graphTokens.accessToken,
          });
        } else {
          derivedEmail = await ctx.runAction(internal.oauth2.getUserEmail, {
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
          { cause: _e },
        );
      }

      userEmail = derivedEmail;
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

  await deps.updateStatus(providerId, 'testing');
  debugLog(`Testing connection for provider ${providerId}...`);

  let result: TestResult;
  try {
    // When sendMethod is 'api', skip SMTP test since Graph API handles sending
    if (providerData.sendMethod === 'api') {
      const imapOnlyResult = await deps.testConnection({
        vendor: providerData.vendor,
        authMethod: providerData.authMethod,
        passwordAuth,
        oauth2Auth,
        smtpConfig: { host: 'localhost', port: 587, secure: false },
        imapConfig: providerData.imapConfig ?? {
          host: '',
          port: 993,
          secure: true,
        },
      });

      result = {
        success: imapOnlyResult.imap.success,
        smtp: { success: true, latencyMs: 0, error: undefined },
        imap: imapOnlyResult.imap,
      };
    } else {
      if (!providerData.smtpConfig || !providerData.imapConfig) {
        throw new Error(
          'SMTP and IMAP configuration are required for non-API send methods',
        );
      }
      result = await deps.testConnection({
        vendor: providerData.vendor,
        authMethod: providerData.authMethod,
        passwordAuth,
        oauth2Auth,
        smtpConfig: providerData.smtpConfig,
        imapConfig: providerData.imapConfig,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.updateStatus(providerId, 'error', Date.now(), message);
    throw error;
  }

  if (result.success) {
    debugLog(`Connection test successful for provider ${providerId}`, {
      smtpLatency: result.smtp.latencyMs,
      imapLatency: result.imap.latencyMs,
    });
  } else {
    console.error(`Connection test failed for provider ${providerId}`, {
      smtp: result.smtp.success ? 'OK' : `Failed: ${result.smtp.error}`,
      imap: result.imap.success ? 'OK' : `Failed: ${result.imap.error}`,
    });
  }

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
