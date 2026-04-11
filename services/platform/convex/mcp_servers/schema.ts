import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonRecordValidator } from '../lib/validators/json';

export const mcpServersTable = defineTable({
  organizationId: v.string(),
  name: v.string(),
  displayName: v.string(),
  description: v.optional(v.string()),
  transportType: v.union(
    v.literal('stdio'),
    v.literal('sse'),
    v.literal('streamable_http'),
  ),
  url: v.optional(v.string()),
  command: v.optional(v.string()),
  args: v.optional(v.array(v.string())),
  env: v.optional(jsonRecordValidator),
  authType: v.union(
    v.literal('none'),
    v.literal('api_key'),
    v.literal('oauth2'),
  ),
  apiKeyEncrypted: v.optional(v.string()),
  oauth2Config: v.optional(
    v.object({
      tokenUrl: v.string(),
      authorizationUrl: v.optional(v.string()),
      clientId: v.string(),
      clientSecretEncrypted: v.string(),
      scopes: v.array(v.string()),
      grantType: v.union(
        v.literal('client_credentials'),
        v.literal('authorization_code'),
      ),
    }),
  ),
  oauth2Tokens: v.optional(
    v.object({
      accessTokenEncrypted: v.string(),
      refreshTokenEncrypted: v.optional(v.string()),
      tokenExpiry: v.optional(v.number()),
    }),
  ),
  status: v.union(
    v.literal('active'),
    v.literal('inactive'),
    v.literal('error'),
    v.literal('discovering'),
  ),
  capabilities: v.optional(
    v.object({
      tools: v.optional(v.boolean()),
      resources: v.optional(v.boolean()),
      prompts: v.optional(v.boolean()),
    }),
  ),
  discoveredTools: v.optional(
    v.array(
      v.object({
        name: v.string(),
        description: v.optional(v.string()),
        inputSchema: v.optional(jsonRecordValidator),
        requiresApproval: v.optional(v.boolean()),
      }),
    ),
  ),
  lastConnectedAt: v.optional(v.number()),
  lastError: v.optional(v.string()),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_org_name', ['organizationId', 'name'])
  .index('by_org_status', ['organizationId', 'status']);
