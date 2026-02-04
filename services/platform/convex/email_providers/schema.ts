import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

export const emailProvidersTable = defineTable({
  organizationId: v.string(),
  name: v.string(),
  vendor: v.union(
    v.literal('gmail'),
    v.literal('outlook'),
    v.literal('smtp'),
    v.literal('resend'),
    v.literal('other'),
  ),
  authMethod: v.union(v.literal('password'), v.literal('oauth2')),
  sendMethod: v.optional(v.union(v.literal('smtp'), v.literal('api'))),
  passwordAuth: v.optional(
    v.object({
      user: v.string(),
      passEncrypted: v.string(),
    }),
  ),
  oauth2Auth: v.optional(
    v.object({
      provider: v.string(),
      clientId: v.string(),
      clientSecretEncrypted: v.string(),
      accessTokenEncrypted: v.optional(v.string()),
      refreshTokenEncrypted: v.optional(v.string()),
      tokenExpiry: v.optional(v.number()),
      tokenUrl: v.optional(v.string()),
    }),
  ),
  smtpConfig: v.optional(
    v.object({
      host: v.string(),
      port: v.number(),
      secure: v.boolean(),
    }),
  ),
  imapConfig: v.optional(
    v.object({
      host: v.string(),
      port: v.number(),
      secure: v.boolean(),
    }),
  ),
  isActive: v.optional(v.boolean()),
  isDefault: v.boolean(),
  status: v.optional(
    v.union(
      v.literal('active'),
      v.literal('error'),
      v.literal('testing'),
      v.literal('pending_authorization'),
    ),
  ),
  lastTestedAt: v.optional(v.number()),
  lastSyncAt: v.optional(v.number()),
  errorMessage: v.optional(v.string()),
  metadata: v.optional(jsonRecordValidator),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_organizationId_and_vendor', ['organizationId', 'vendor'])
  .index('by_organizationId_and_isDefault', ['organizationId', 'isDefault'])
  .index('by_organizationId_and_status', ['organizationId', 'status']);
