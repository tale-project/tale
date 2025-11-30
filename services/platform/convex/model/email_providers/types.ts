/**
 * Types and validators for email providers
 */

import { v } from 'convex/values';
import type { Doc } from '../../_generated/dataModel';

// =============================================================================
// TypeScript Types
// =============================================================================

export type EmailProviderVendor =
  | 'gmail'
  | 'outlook'
  | 'smtp'
  | 'resend'
  | 'other';
export type EmailProviderAuthMethod = 'password' | 'oauth2';
export type EmailProviderStatus = 'active' | 'error' | 'testing';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
}

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
}

export interface UpdateProviderStatusArgs {
  providerId: Doc<'emailProviders'>['_id'];
  status?: EmailProviderStatus;
  lastTestedAt?: number;
  errorMessage?: string;
}

export interface GetProviderByIdArgs {
  providerId: Doc<'emailProviders'>['_id'];
}

// =============================================================================
// Convex Validators
// =============================================================================

export const emailProviderVendorValidator = v.union(
  v.literal('gmail'),
  v.literal('outlook'),
  v.literal('smtp'),
  v.literal('resend'),
  v.literal('other'),
);

export const emailProviderAuthMethodValidator = v.union(
  v.literal('password'),
  v.literal('oauth2'),
);

export const emailProviderStatusValidator = v.union(
  v.literal('active'),
  v.literal('error'),
  v.literal('testing'),
);

export const smtpConfigValidator = v.object({
  host: v.string(),
  port: v.number(),
  secure: v.boolean(),
});

export const imapConfigValidator = v.object({
  host: v.string(),
  port: v.number(),
  secure: v.boolean(),
});
