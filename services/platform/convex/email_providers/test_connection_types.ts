/**
 * Shared types for email provider connection testing helpers.
 */

import type {
  EmailProviderAuthMethod,
  EmailProviderVendor,
  ImapConfig,
  SmtpConfig,
} from './types';

export interface TestConnectionArgs {
  vendor: EmailProviderVendor;
  authMethod: EmailProviderAuthMethod;
  passwordAuth?: { user: string; pass: string };
  oauth2Auth?: { user: string; accessToken: string };
  smtpConfig: SmtpConfig;
  imapConfig: ImapConfig;
}

export interface VerifySmtpConnectionParams {
  smtpConfig: SmtpConfig;
  auth: Record<string, unknown>;
}

// Minimal auth shape compatible with ImapFlow's expected `auth` object.
export interface ImapAuth {
  user: string;
  pass?: string;
  accessToken?: string;
  loginMethod?: string;
  authzid?: string;
}

export interface VerifyImapConnectionParams {
  imapConfig: ImapConfig;
  auth: ImapAuth;
}

export interface TestConnectionDeps {
  verifySmtpConnection: (params: VerifySmtpConnectionParams) => Promise<void>;
  verifyImapConnection: (params: VerifyImapConnectionParams) => Promise<void>;
}

export interface SingleConnectionResult {
  success: boolean;
  latencyMs: number;
  error?: string;
}
