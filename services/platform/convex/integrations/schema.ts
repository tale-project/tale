import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

export const integrationsTable = defineTable({
  organizationId: v.string(),
  name: v.string(),
  title: v.string(),
  description: v.optional(v.string()),
  type: v.optional(v.union(v.literal('rest_api'), v.literal('sql'))),
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
  connector: v.optional(
    v.object({
      code: v.string(),
      version: v.number(),
      operations: v.array(
        v.object({
          name: v.string(),
          title: v.optional(v.string()),
          description: v.optional(v.string()),
          parametersSchema: v.optional(jsonRecordValidator),
          operationType: v.optional(
            v.union(v.literal('read'), v.literal('write')),
          ),
          requiresApproval: v.optional(v.boolean()),
        }),
      ),
      secretBindings: v.array(v.string()),
      allowedHosts: v.optional(v.array(v.string())),
      timeoutMs: v.optional(v.number()),
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
  sqlOperations: v.optional(
    v.array(
      v.object({
        name: v.string(),
        title: v.optional(v.string()),
        description: v.optional(v.string()),
        query: v.string(),
        parametersSchema: v.optional(jsonRecordValidator),
        operationType: v.optional(
          v.union(v.literal('read'), v.literal('write')),
        ),
        requiresApproval: v.optional(v.boolean()),
      }),
    ),
  ),
  iconStorageId: v.optional(v.id('_storage')),
  metadata: v.optional(jsonRecordValidator),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_organizationId_and_name', ['organizationId', 'name'])
  .index('by_organizationId_and_status', ['organizationId', 'status'])
  .index('by_status', ['status']);
