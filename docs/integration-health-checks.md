# Integration Health Checks

## Overview

This document describes the health check system implemented for Shopify and Circuly integrations. Health checks are automatically run when creating or updating integrations to ensure credentials are valid before saving them to the database.

**Note:** Gmail and Outlook are managed separately through the `emailProviders` system and do not use the `integrations` table. They have their own authentication flow using OAuth2.

## Implementation

### Key Features

1. **Automatic Health Checks on Create**: When creating a new Shopify or Circuly integration, the credentials are validated against the actual API before the integration is saved.

2. **Automatic Health Checks on Update**: When updating credentials for an existing integration, the new credentials are validated before being saved.

3. **Fail-Fast Behavior**: If a health check fails, an error is thrown and the integration is NOT created/updated. This prevents invalid integrations from being stored.

4. **User-Friendly Error Messages**: Detailed error messages help users understand what went wrong:
   - "Shopify authentication failed. Please check your access token."
   - "Shopify store not found. Please verify your domain."
   - "Circuly authentication failed. Please check your username and password."

5. **Active Status on Success**: When a health check passes during creation, the integration is automatically set to `status: 'active'` and `isActive: true`.

### Health Check Functions

#### `testShopifyConnection(domain, accessToken)`

Tests a Shopify connection by calling the `/admin/api/2024-01/shop.json` endpoint.

**Validates:**

- Access token is valid
- Store domain exists
- API permissions are correct

**Error Codes:**

- 401: Invalid access token
- 403: Insufficient permissions
- 404: Store not found

#### `testCirculyConnection(username, password)`

Tests a Circuly connection by calling the `/v1/account` endpoint with basic authentication.

**Validates:**

- Username and password are correct
- Account has proper permissions

**Error Codes:**

- 401: Invalid credentials
- 403: Insufficient permissions

### Integration Points

The health checks are integrated into three key functions:

1. **`create` action**: Runs health check before creating a new integration
2. **`update` action**: Runs health check when credentials are being updated
3. **`testConnection` action**: Uses the same health check functions for manual testing

## Usage

### Creating an Integration

```typescript
// Shopify
const integrationId = await ctx.runAction(api.integrations.create, {
  organizationId: 'org123',
  provider: 'shopify',
  authMethod: 'api_key',
  apiKeyAuth: {
    key: 'shpat_abc123...',
    keyPrefix: 'shpat_',
  },
  connectionConfig: {
    domain: 'mystore.myshopify.com',
  },
});
// If health check fails, an error is thrown and no integration is created

// Circuly
const integrationId = await ctx.runAction(api.integrations.create, {
  organizationId: 'org123',
  provider: 'circuly',
  authMethod: 'basic_auth',
  basicAuth: {
    username: 'myusername',
    password: 'mypassword',
  },
});
// If health check fails, an error is thrown and no integration is created
```

### Updating Credentials

```typescript
await ctx.runAction(api.integrations.update, {
  integrationId: 'int123',
  apiKeyAuth: {
    key: 'new_token_here',
  },
  connectionConfig: {
    domain: 'newstore.myshopify.com',
  },
});
// Health check runs automatically when credentials are changed
```

### Manual Testing

```typescript
const result = await ctx.runAction(api.integrations.testConnection, {
  integrationId: 'int123',
});
// Returns { success: boolean, message: string }
```

## Error Handling

When a health check fails:

1. An error is thrown with a descriptive message
2. The integration is NOT created or updated
3. The error propagates to the UI where it's displayed to the user
4. For existing integrations being updated, the old credentials remain unchanged

## Logging

Health checks log their progress:

```
[Integration Create] Running health check for shopify...
[Shopify Health Check] Successfully connected to My Store Name
[Integration Create] Health check passed for shopify
[Integration Create] Successfully created shopify integration with ID: xyz
```

Failed health checks log errors:

```
[Integration Create] Running health check for shopify...
[Integration Create] Health check failed for shopify: Shopify authentication failed. Please check your access token.
```

## Architecture Notes

### Integration Types

**Integrations Table (with Health Checks):**

- Shopify - API key authentication
- Circuly - Basic authentication

**Email Providers Table (OAuth2):**

- Gmail - OAuth2 authentication
- Outlook - OAuth2 authentication
- SMTP/IMAP - Custom configurations

Email providers use a separate system (`emailProviders` table) because they have different authentication requirements (OAuth2), connection patterns (SMTP/IMAP), and use cases (email sending/receiving).

## Future Enhancements

Potential improvements:

1. Implement periodic health checks to detect stale credentials
2. Add retry logic with exponential backoff
3. Store health check history for debugging
4. Add more granular permission checks
5. Add webhook verification for supported integrations

## Related Files

**Integration System:**

- `/convex/integrations.ts` - Main integration management file with health checks
- `/convex/schema.ts` - Integration table schema (Shopify, Circuly)
- `/app/(app)/dashboard/[id]/settings/integrations/components/shopify-integration-dialog.tsx` - Shopify UI
- `/app/(app)/dashboard/[id]/settings/integrations/components/circuly-integration-dialog.tsx` - Circuly UI

**Email Provider System:**

- `/convex/emailProviders.ts` - Email provider management (Gmail, Outlook, SMTP)
- `/app/(app)/dashboard/[id]/settings/integrations/components/gmail-integration-dialog.tsx` - Gmail UI
- `/app/(app)/dashboard/[id]/settings/integrations/components/outlook-integration-dialog.tsx` - Outlook UI

## Testing

To test the health check system:

1. **Valid Credentials**: Create an integration with valid credentials - should succeed
2. **Invalid Token**: Use an invalid access token - should fail with authentication error
3. **Invalid Domain**: Use a non-existent domain - should fail with store not found error
4. **Network Issues**: Simulate network failures to ensure proper error handling
