import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonRecordValidator } from '../lib/validators/json';

/**
 * Slim credentials table for installed integrations.
 *
 * Integration definitions (operations, connector code, config) live in filesystem
 * files under INTEGRATIONS_DIR. This table stores only per-installation runtime
 * data: encrypted credentials, status, health metrics, and icon storage.
 *
 * The `slug` field matches the integration directory name (the canonical identifier).
 */
export const integrationCredentialsTable = defineTable({
  organizationId: v.string(),
  slug: v.string(),
  status: v.union(
    v.literal('active'),
    v.literal('inactive'),
    v.literal('error'),
    v.literal('testing'),
  ),
  isActive: v.boolean(),
  authMethod: v.union(
    v.literal('api_key'),
    v.literal('bearer_token'),
    v.literal('basic_auth'),
    v.literal('oauth2'),
  ),
  supportedAuthMethods: v.optional(
    v.array(
      v.union(
        v.literal('api_key'),
        v.literal('bearer_token'),
        v.literal('basic_auth'),
        v.literal('oauth2'),
      ),
    ),
  ),
  apiKeyAuth: v.optional(
    v.object({
      keyEncrypted: v.string(),
      keyPrefix: v.optional(v.string()),
    }),
  ),
  basicAuth: v.optional(
    v.object({
      username: v.string(),
      passwordEncrypted: v.string(),
    }),
  ),
  oauth2Auth: v.optional(
    v.object({
      accessTokenEncrypted: v.string(),
      refreshTokenEncrypted: v.optional(v.string()),
      tokenExpiry: v.optional(v.number()),
      scopes: v.optional(v.array(v.string())),
    }),
  ),
  oauth2Config: v.optional(
    v.object({
      authorizationUrl: v.string(),
      tokenUrl: v.string(),
      scopes: v.optional(v.array(v.string())),
      clientId: v.optional(v.string()),
      clientSecretEncrypted: v.optional(v.string()),
    }),
  ),
  connectionConfig: v.optional(
    v.object({
      domain: v.optional(v.string()),
      apiVersion: v.optional(v.string()),
      apiEndpoint: v.optional(v.string()),
      timeout: v.optional(v.number()),
      rateLimit: v.optional(v.number()),
    }),
  ),
  sqlConnectionConfig: v.optional(
    v.object({
      engine: v.union(
        v.literal('mssql'),
        v.literal('postgres'),
        v.literal('mysql'),
      ),
      server: v.optional(v.string()),
      port: v.optional(v.number()),
      database: v.optional(v.string()),
      readOnly: v.optional(v.boolean()),
      options: v.optional(
        v.object({
          encrypt: v.optional(v.boolean()),
          trustServerCertificate: v.optional(v.boolean()),
          connectionTimeout: v.optional(v.number()),
          requestTimeout: v.optional(v.number()),
        }),
      ),
      security: v.optional(
        v.object({
          maxResultRows: v.optional(v.number()),
          queryTimeoutMs: v.optional(v.number()),
          maxConnectionPoolSize: v.optional(v.number()),
        }),
      ),
    }),
  ),
  lastSyncedAt: v.optional(v.number()),
  lastTestedAt: v.optional(v.number()),
  lastSuccessAt: v.optional(v.number()),
  lastErrorAt: v.optional(v.number()),
  errorMessage: v.optional(v.string()),
  syncStats: v.optional(
    v.object({
      totalRecords: v.optional(v.number()),
      lastSyncCount: v.optional(v.number()),
      failedSyncCount: v.optional(v.number()),
    }),
  ),
  capabilities: v.optional(
    v.object({
      canSync: v.optional(v.boolean()),
      canPush: v.optional(v.boolean()),
      canWebhook: v.optional(v.boolean()),
      syncFrequency: v.optional(v.string()),
    }),
  ),
  iconStorageId: v.optional(v.id('_storage')),
  metadata: v.optional(jsonRecordValidator),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_organizationId_and_slug', ['organizationId', 'slug'])
  .index('by_status', ['status']);
