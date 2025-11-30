# Integrations Schema Documentation

## Overview

The `integrations` table has been redesigned from a generic, unstructured table to a fully-typed, structured system for managing third-party service connections (Shopify, Circuly, Stripe, etc.).

## Key Improvements

### Before

```typescript
integrations: defineTable({
  organizationId: v.id('organizations'),
  provider: v.string(), // Too generic
  status: v.optional(v.string()), // Too generic
  metadata: v.optional(v.any()), // Everything in unstructured metadata
});
```

### After

```typescript
integrations: defineTable({
  organizationId: v.id('organizations'),

  // Structured provider identification
  provider: v.union(
    v.literal('shopify'),
    v.literal('circuly'),
    v.literal('stripe'),
    v.literal('firmhouse'),
  ),
  name: v.string(),

  // Typed status
  status: v.union(
    v.literal('active'),
    v.literal('inactive'),
    v.literal('error'),
    v.literal('testing'),
  ),

  // Structured authentication
  authMethod: v.union(
    v.literal('api_key'),
    v.literal('bearer_token'),
    v.literal('basic_auth'),
    v.literal('oauth2'),
  ),

  // Encrypted credentials (like emailProviders pattern)
  apiKeyAuth: v.optional({ keyEncrypted, keyPrefix }),
  basicAuth: v.optional({ username, passwordEncrypted }),
  oauth2Auth: v.optional({ accessTokenEncrypted, ... }),

  // Provider-specific config (structured, not v.any())
  connectionConfig: v.optional({
    domain, apiVersion, apiEndpoint, timeout, rateLimit
  }),

  // Health tracking
  lastSyncedAt, lastTestedAt, lastSuccessAt, lastErrorAt, errorMessage,

  // Sync statistics
  syncStats: { totalRecords, lastSyncCount, failedSyncCount },

  // Capabilities
  capabilities: { canSync, canPush, canWebhook, syncFrequency },

  // Only truly unstructured data
  metadata: v.optional(v.any()),
})
```

## Benefits

### 1. Type Safety

- IDE autocomplete for all fields
- Compile-time validation
- No runtime surprises

### 2. Security

- Credentials encrypted at rest (follows `emailProviders` pattern)
- Clear separation between config and secrets
- Audit trail with timestamps

### 3. Observability

- Health metrics (lastSuccessAt, lastErrorAt)
- Sync statistics
- Error messages

### 4. Flexibility

- Provider-specific config in structured object
- Capabilities flag for feature toggles
- Still extensible via `metadata`

## Usage Examples

### Creating a Shopify Integration

```typescript
const integrationId = await ctx.runAction(api.integrations.create, {
  organizationId: args.organizationId,
  provider: 'shopify',
  name: 'Main Store',
  authMethod: 'api_key',
  apiKeyAuth: {
    key: 'shpat_1234...', // Will be encrypted
    keyPrefix: 'shpat_',
  },
  connectionConfig: {
    domain: 'mystore.myshopify.com',
    apiVersion: '2024-01',
    timeout: 30000,
  },
  capabilities: {
    canSync: true,
    canPush: false,
    canWebhook: true,
    syncFrequency: 'hourly',
  },
});
```

### Creating a Circuly Integration

```typescript
const integrationId = await ctx.runAction(api.integrations.create, {
  organizationId: args.organizationId,
  provider: 'circuly',
  name: 'Circuly Subscriptions',
  authMethod: 'bearer_token',
  apiKeyAuth: {
    key: apiKey, // Will be encrypted
  },
  connectionConfig: {
    apiEndpoint: 'https://api.circuly.io/api/2025-01',
  },
  capabilities: {
    canSync: true,
    canPush: false,
    syncFrequency: 'daily',
  },
});
```

### Querying Integrations

```typescript
// Get all integrations for an organization
const integrations = await ctx.runQuery(api.integrations.list, {
  organizationId,
});

// Get specific provider integration
const shopifyIntegration = await ctx.runQuery(api.integrations.getByProvider, {
  organizationId,
  provider: 'shopify',
});

// Get decrypted credentials (for actions)
const credentials = await ctx.runAction(
  api.integrations.getDecryptedCredentials,
  {
    integrationId,
  }
);
// Returns: { apiKey, domain, connectionConfig, ... }
```

### Testing Connection

```typescript
const result = await ctx.runAction(api.integrations.testConnection, {
  integrationId,
});

if (result.success) {
  // Integration is active and working
  console.log(result.message);
} else {
  // Integration has errors
  console.error(result.message);
}
```

### Updating Sync Stats

```typescript
await ctx.runMutation(api.integrations.updateSyncStats, {
  integrationId,
  totalRecords: 1500,
  lastSyncCount: 150,
  failedSyncCount: 2,
});
```

## API Reference

### Queries

- `list(organizationId, provider?)` - List integrations
- `get(integrationId)` - Get single integration
- `getByProvider(organizationId, provider)` - Get by provider

### Actions

- `create(...)` - Create integration with encryption
- `update(integrationId, ...)` - Update integration
- `testConnection(integrationId)` - Test integration
- `getDecryptedCredentials(integrationId)` - Get decrypted creds

### Mutations

- `deleteIntegration(integrationId)` - Delete integration
- `updateSyncStats(integrationId, ...)` - Update sync stats

## Integration with Workflows

The Shopify workflow action now supports loading credentials from the integrations table:

### Priority Order

1. Direct parameters (`domain`, `accessToken`)
2. `variables.shopify`
3. `variables.workflow.shopify`
4. Integration table (via `shopifyIntegrationId` or `organizationId`)

### Example Workflow Usage

```typescript
// Option 1: Direct parameters (existing)
{
  domain: 'mystore.myshopify.com',
  accessToken: 'shpat_...',
  resource: 'products',
}

// Option 2: Via variables (existing)
variables: {
  shopify: {
    domain: 'mystore.myshopify.com',
    accessToken: 'shpat_...',
  }
}

// Option 3: From integration table (new - TODO)
variables: {
  shopifyIntegrationId: 'j1234...', // Load from specific integration
  // OR
  organizationId: 'k5678...', // Auto-find Shopify integration
}
```

## Security Considerations

### Encryption

- All credentials encrypted using `oauth2.encrypt/decrypt` actions
- Same pattern as `emailProviders`
- Encryption keys stored in environment variables

### Access Control

- Integration credentials only decrypted in actions
- Mutations work with encrypted values
- Queries never return decrypted credentials

### Audit Trail

- `lastTestedAt` - When connection was last tested
- `lastSyncedAt` - When last sync occurred
- `lastSuccessAt` / `lastErrorAt` - Success/failure tracking
- `errorMessage` - Last error details

## Migration Path

For existing systems using variables for credentials:

1. **Phase 1**: Keep using variables (fully backward compatible)
2. **Phase 2**: Create integrations through UI
3. **Phase 3**: Workflows automatically use integration table as fallback
4. **Phase 4**: Remove inline credentials from variables

## Comparison with EmailProviders

| Feature               | emailProviders            | integrations                       |
| --------------------- | ------------------------- | ---------------------------------- |
| Schema Structure      | ✅ Fully structured       | ✅ Fully structured                |
| Encryption            | ✅ Encrypted credentials  | ✅ Encrypted credentials           |
| Multiple Auth Methods | ✅ Password, OAuth2, SMTP | ✅ API Key, Basic, OAuth2          |
| Health Tracking       | ✅ Status, last tested    | ✅ Status, last tested, sync stats |
| Provider Config       | ✅ SMTP/IMAP config       | ✅ Connection config               |
| Multiple per Org      | ✅ Multiple providers     | ✅ Multiple providers              |

## Next Steps

1. ✅ Schema updated
2. ✅ Backend API created (`convex/integrations.ts`)
3. ✅ Shopify workflow action updated
4. 🔄 UI integration handlers (placeholder TODOs)
5. ⏳ Actual connection testing implementation
6. ⏳ Sync job integration
7. ⏳ Webhook support

## Files Changed

- `convex/schema.ts` - Updated integrations table
- `convex/integrations.ts` - New integration management API
- `convex/workflow/nodes/action/actions/shopify.ts` - Updated to support integration lookup
- `app/(app)/dashboard/[id]/settings/integrations/integrations.tsx` - Placeholder handlers
