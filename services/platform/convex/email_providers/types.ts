/**
 * Type definitions for email providers
 */

import type { Infer } from 'convex/values';
import type { Doc } from '../_generated/dataModel';
import {
  emailProviderAuthMethodValidator,
  emailProviderDocValidator,
  emailProviderStatusValidator,
  emailProviderVendorValidator,
  imapConfigValidator,
  smtpConfigValidator,
} from './validators';

// =============================================================================
// INFERRED TYPES (from validators)
// =============================================================================

export type EmailProviderVendor = Infer<typeof emailProviderVendorValidator>;
export type EmailProviderAuthMethod = Infer<
  typeof emailProviderAuthMethodValidator
>;
export type EmailProviderStatus = Infer<typeof emailProviderStatusValidator>;
export type SmtpConfig = Infer<typeof smtpConfigValidator>;
export type ImapConfig = Infer<typeof imapConfigValidator>;
export type EmailProviderDoc = Infer<typeof emailProviderDocValidator>;

// =============================================================================
// MANUAL TYPES (no corresponding validator)
// =============================================================================

export interface UpdateProviderStatusArgs {
  providerId: Doc<'emailProviders'>['_id'];
  status?: EmailProviderStatus;
  lastTestedAt?: number;
  errorMessage?: string;
}

export interface GetProviderByIdArgs {
  providerId: Doc<'emailProviders'>['_id'];
}
