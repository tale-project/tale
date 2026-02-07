import type { Doc } from '../_generated/dataModel';

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
