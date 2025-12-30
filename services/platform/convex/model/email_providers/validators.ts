/**
 * Convex validators for email providers
 */

import { v } from 'convex/values';

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
