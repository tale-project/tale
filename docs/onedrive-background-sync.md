# OneDrive Background Sync

This document explains how the OneDrive background sync system works, including how member credentials are stored and used for scheduled syncs.

## Overview

When a user enables auto-sync for OneDrive files or folders, the system stores:

1. The OneDrive item configuration (file/folder ID, path, etc.)
2. The **user ID** (Better Auth userId) of the member who enabled the sync
3. Sync settings and status

When a background sync job runs (via cron or scheduled workflow), it:

1. Queries active sync configurations
2. For each configuration, retrieves the Microsoft Graph access token for the **stored userId**
3. Uses that user's credentials to sync files from OneDrive

## Schema Changes

### onedriveSyncConfigs Table

The `onedriveSyncConfigs` table now includes a `userId` field:

```typescript
onedriveSyncConfigs: defineTable({
  organizationId: v.string(), // Better Auth organization ID
  userId: v.string(), // Better Auth user ID (whose credentials to use for sync)
  itemType: v.union(v.literal('file'), v.literal('folder')),
  itemId: v.string(), // OneDrive item ID
  itemName: v.string(), // File or folder name
  itemPath: v.optional(v.string()),
  targetBucket: v.string(),
  storagePrefix: v.optional(v.string()),
  status: v.union(
    v.literal('active'),
    v.literal('inactive'),
    v.literal('error'),
  ),
  lastSyncAt: v.optional(v.number()),
  lastSyncStatus: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  metadata: v.optional(v.any()),
});
```

## How It Works

### 1. User Enables Auto-Sync

When a user enables auto-sync through the UI:

```typescript
import { enableAutoSync } from '@/actions/onedrive/config/enable-auto-sync';

// User clicks "Enable Auto-Sync" on a folder
const result = await enableAutoSync(organizationId, {
  itemType: 'folder',
  folderId: 'folder-123',
  folderName: 'Documents',
  folderPath: '/Documents',
  targetBucket: 'documents',
});
```

The `enableAutoSync` action:

1. Gets the current authenticated user
2. Creates a sync configuration with the user's ID
3. Stores it in the `onedriveSyncConfigs` table

```typescript
// Inside enableAutoSync
const user = await getCurrentUser();
if (!user) {
  return { success: false, error: 'User not authenticated' };
}

await fetchMutation(api.documents.createOneDriveSyncConfig, {
  organizationId: organizationId,
  userId: user._id, // Store the user's ID
  itemType: 'folder',
  itemId: params.folderId,
  itemName: params.folderName,
  // ... other fields
});
```

### 2. Background Sync Job Runs

When a background sync job (cron or scheduled workflow) runs:

```typescript
import { getMicrosoftGraphTokenForUser } from '@/lib/microsoft-graph-client-for-user';
import { MicrosoftGraphClient } from '@/lib/microsoft-graph-client';

// Get all active sync configurations
const configs = await ctx.db
  .query('onedriveSyncConfigs')
  .withIndex('by_organizationId_and_status', (q) =>
    q.eq('organizationId', organizationId).eq('status', 'active'),
  )
  .collect();

// Process each configuration
for (const config of configs) {
  // Get Microsoft Graph token for the user who created this sync config
  const token = await getMicrosoftGraphTokenForUser(config.userId);

  if (!token) {
    console.error(`No token available for user ${config.userId}`);
    continue;
  }

  // Create Microsoft Graph client with the user's token
  const graphClient = new MicrosoftGraphClient(token);

  // Sync files using the user's credentials
  if (config.itemType === 'file') {
    const fileContent = await graphClient.readFile(config.itemId);
    // Upload to storage...
  } else {
    const files = await graphClient.listFiles({ folderId: config.itemId });
    // Process files...
  }
}
```

### 3. Token Management

The system automatically handles token refresh:

```typescript
// getMicrosoftGraphTokenForUser checks if token is expired
export async function getMicrosoftGraphTokenForUser(
  userId: string,
): Promise<string | null> {
  // Query Microsoft account for the specific user
  const microsoftAccount = await fetchQuery(
    api.accounts.getMicrosoftAccountByUserId,
    { userId },
  );

  // Check if token is expired
  if (microsoftAccount.accessTokenExpiresAt < Date.now() + 5 * 60 * 1000) {
    // Refresh the token if expired
    const refreshed = await refreshMicrosoftTokenForUser(
      microsoftAccount.refreshToken,
      microsoftAccount.accountId,
    );
    return refreshed.accessToken;
  }

  return microsoftAccount.accessToken;
}
```

## API Reference

### New Functions

#### `getMicrosoftGraphTokenForUser(userId: string)`

Retrieves the Microsoft Graph access token for a specific user (not the current authenticated user).

**Location:** `services/platform/lib/microsoft-graph-client-for-user.ts`

**Usage:**

```typescript
import { getMicrosoftGraphTokenForUser } from '@/lib/microsoft-graph-client-for-user';

const token = await getMicrosoftGraphTokenForUser('user-123');
if (token) {
  // Use token to access Microsoft Graph API
}
```

#### `api.accounts.getMicrosoftAccountByUserId`

Convex query to get Microsoft OAuth account for a specific user.

**Usage:**

```typescript
const account = await ctx.runQuery(api.accounts.getMicrosoftAccountByUserId, {
  userId: 'user-123',
});
```

### Updated Functions

#### `createOneDriveSyncConfig`

Now requires `userId` parameter:

```typescript
await fetchMutation(api.documents.createOneDriveSyncConfig, {
  organizationId: 'org-123',
  userId: 'user-123', // NEW: Required field
  itemType: 'file',
  itemId: 'file-456',
  itemName: 'document.pdf',
  targetBucket: 'documents',
});
```

#### `getOneDriveSyncConfigs`

Now returns `userId` in the config objects:

```typescript
const result = await fetchQuery(api.documents.getOneDriveSyncConfigs, {
  organizationId: 'org-123',
  status: 'active',
});

// result.configs[0].userId is now available
```

## Example: Background Sync Workflow

Here's a complete example of a background sync workflow:

```typescript
// services/platform/workflows/onedrive-sync.ts
import type { InlineWorkflowDefinition } from './types';

export const onedriveSyncWorkflow: InlineWorkflowDefinition = {
  workflowConfig: {
    name: 'OneDrive Auto Sync',
    description: 'Sync files from OneDrive based on active sync configurations',
    version: '1.0.0',
    workflowType: 'predefined',
    config: {
      timeout: 300000, // 5 minutes
      retryPolicy: { maxRetries: 3, backoffMs: 2000 },
      variables: {
        organizationId: 'org_demo',
      },
    },
  },
  stepsConfig: [
    {
      stepSlug: 'start',
      name: 'start',
      stepType: 'trigger',
      order: 1,
      config: {
        type: 'schedule',
        schedule: '0 */1 * * *', // Every hour
        timezone: 'UTC',
      },
      nextSteps: { success: 'get_sync_configs' },
    },
    {
      stepSlug: 'get_sync_configs',
      name: 'Get Active Sync Configurations',
      stepType: 'action',
      order: 2,
      config: {
        type: 'custom',
        // Query active sync configs and process each one
      },
      nextSteps: { success: 'sync_files' },
    },
    // ... more steps
  ],
};
```

## Security Considerations

1. **User Credentials**: Each sync configuration uses the credentials of the user who created it. If that user's Microsoft account is disconnected or their token expires and cannot be refreshed, the sync will fail.

2. **Token Storage**: Microsoft Graph access tokens and refresh tokens are stored securely in the Better Auth accounts table.

3. **Token Refresh**: The system automatically refreshes expired tokens before using them for sync operations.

4. **Error Handling**: If a user's credentials are no longer valid, the sync configuration should be marked as 'error' status and the user should be notified to reconnect their Microsoft account.

## Migration Notes

If you have existing `onedriveSyncConfigs` records without a `userId` field, you'll need to:

1. Run a migration to add the `userId` field to existing records
2. Either assign a default user or mark them as inactive until a user re-enables them

Example migration:

```typescript
// Mark all existing configs without userId as inactive
const configs = await ctx.db.query('onedriveSyncConfigs').collect();
for (const config of configs) {
  if (!config.userId) {
    await ctx.db.patch(config._id, {
      status: 'inactive',
      errorMessage: 'Please re-enable sync to assign user credentials',
    });
  }
}
```
