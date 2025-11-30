# OneDrive Integration Guide

This guide explains how to use OneDrive file synchronization features in the frontend, including manual upload and automatic sync functionality.

## Overview

Our OneDrive integration provides two distinct sync methods:

1. **Manual Upload (One-time)** - Direct file selection and immediate sync without persistent configuration
2. **Auto Sync** - Persistent sync configurations that can be triggered manually or run automatically

## 🔄 Manual Upload (One-time Sync)

### What is Manual Upload?

Manual upload allows users to browse OneDrive files, select specific files/folders, and sync them immediately to Supabase storage without creating any persistent auto-sync configuration.

### Frontend Implementation

#### 1. Using OneDrive File Browser Component

```tsx
import OneDriveFileBrowser from '@/components/onedrive/onedrive-file-browser';

function DocumentsPage({ businessId }: { businessId: string }) {
  return (
    <div>
      <h1>Documents</h1>
      <OneDriveFileBrowser businessId={businessId} />
    </div>
  );
}
```

#### 2. Using OneDrive Import Dialog

```tsx
import OneDriveImportDialog from '@/app/(app)/dashboard/[id]/documents/components/onedrive-import-dialog';

function ImportButton({ businessId }: { businessId: string }) {
  const [isOpen, setIsOpen] = useState(false);

  const handleSuccess = () => {
    // Handle successful import
    setIsOpen(false);
    // Refresh your document list
  };

  return (
    <OneDriveImportDialog
      businessId={businessId}
      open={isOpen}
      onOpenChange={setIsOpen}
      onSuccess={handleSuccess}
    />
  );
}
```

#### 3. Direct API Call (Advanced)

```tsx
async function syncSelectedFiles(
  businessId: string,
  selectedFiles: Array<{
    id: string;
    name: string;
    size?: number;
    relativePath?: string;
  }>,
) {
  const response = await fetch('/api/documents/onedrive', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      items: selectedFiles,
      businessId,
      importType: 'one-time', // Important: Use 'one-time' for manual upload
    }),
  });

  if (!response.ok) {
    throw new Error('Sync failed');
  }

  // Handle streaming response
  const reader = response.body?.getReader();
  // Process SSE events...
}
```

### Key Features

- ✅ No persistent configuration required
- ✅ Immediate file sync
- ✅ User selects files directly from OneDrive browser
- ✅ Real-time progress updates via SSE
- ✅ Support for both files and folders

## ⚙️ Auto Sync Configuration

### What is Auto Sync?

Auto sync creates persistent configurations that can sync OneDrive files/folders automatically on a schedule or be triggered manually. These configurations are stored in the `OneDriveAutoSync` table.

### Frontend Implementation

#### 1. Using Auto Sync Manager Component

```tsx
import AutoSyncManager from '@/components/onedrive/auto-sync-manager';

function OneDriveSettingsPage({ businessId }: { businessId: string }) {
  return (
    <div>
      <h1>OneDrive Auto Sync</h1>
      <AutoSyncManager businessId={businessId} />
    </div>
  );
}
```

#### 2. Enable Auto Sync for Specific Items

```tsx
import { enableAutoSync } from '@/actions/onedrive/config/enable-auto-sync';

async function enableFolderAutoSync(businessId: string, folderId: string) {
  const result = await enableAutoSync(businessId, {
    itemType: 'folder',
    folderId: folderId,
    folderName: 'My Documents',
    folderPath: '/Documents',
    targetBucket: 'documents',
    syncFrequencyMinutes: 60, // Sync every hour
    maxFileSizeMb: 100,
    allowedExtensions: ['pdf', 'docx', 'xlsx'],
    excludePatterns: ['*.tmp', 'temp/*'],
  });

  if (result.success) {
    console.log('Auto sync enabled:', result.data);
  } else {
    console.error('Failed to enable auto sync:', result.error);
  }
}
```

#### 3. Manually Trigger Auto Sync

```tsx
import { runAutoSyncOnce } from '@/actions/onedrive/sync/run-auto-sync-once';

async function triggerSync(businessId: string, itemId: string) {
  const result = await runAutoSyncOnce(businessId, itemId);

  if (result.success) {
    console.log(`Synced ${result.successfulFiles}/${result.totalFiles} files`);
  } else {
    console.error('Sync failed:', result.error);
  }
}
```

### Auto Sync Configuration Options

```typescript
interface AutoSyncConfig {
  itemType: 'file' | 'folder';

  // For files
  fileId?: string;
  fileName?: string;
  filePath?: string;

  // For folders
  folderId?: string;
  folderName?: string;
  folderPath?: string;

  // Common options
  targetBucket?: string; // Default: 'documents'
  targetPath?: string;
  storagePrefix?: string;
  syncFrequencyMinutes?: number; // Default: 60
  maxFileSizeMb?: number; // Default: 100
  allowedExtensions?: string[];
  blockedExtensions?: string[];
  includePatterns?: string[];
  excludePatterns?: string[];
}
```

## 📊 Sync Status and Monitoring

### Check Sync Status

```tsx
import { getOneDriveSyncStatus } from '@/actions/onedrive/sync-status';

async function checkSyncStatus() {
  const result = await getOneDriveSyncStatus('documents');

  if (result.success) {
    result.syncedFiles.forEach((fileInfo, oneDriveId) => {
      console.log(`File ${fileInfo.fileName} synced at ${fileInfo.lastSynced}`);
    });
  }
}
```

### Get Sync Statistics

```tsx
import { getSyncStatistics } from '@/actions/onedrive/sync-status';

async function loadSyncStats() {
  const stats = await getSyncStatistics('documents');
  console.log(`Total synced files: ${stats.totalFiles}`);
  console.log(`Total size: ${stats.totalSizeMB} MB`);
}
```

## 🔧 Available Actions and Routes

### Server Actions

| Action                  | File                                                        | Purpose                        |
| ----------------------- | ----------------------------------------------------------- | ------------------------------ |
| `enableAutoSync`        | `/actions/onedrive/config/enable-auto-sync.ts`              | Create/update auto-sync config |
| `disableAutoSync`       | `/actions/onedrive/config/disable-auto-sync.ts`             | Disable auto-sync config       |
| `runAutoSyncOnce`       | `/actions/onedrive/sync/run-auto-sync-once.ts`              | Manually trigger auto-sync     |
| `getOneDriveSyncStatus` | `/actions/onedrive/sync-status/get-onedrive-sync-status.ts` | Check file sync status         |
| `listOneDriveFiles`     | `/actions/onedrive/list-files.ts`                           | Browse OneDrive files          |

### API Routes

| Route                     | Method   | Purpose                    |
| ------------------------- | -------- | -------------------------- |
| `/api/documents/onedrive` | POST     | Manual file upload/sync    |
| `/api/cron/onedrive-sync` | GET/POST | Scheduled auto-sync (cron) |

## 🎯 Usage Examples

### Example 1: Simple File Browser

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { listOneDriveFiles } from '@/actions/onedrive/list-files';

export default function SimpleFileBrowser() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadFiles = async () => {
    setLoading(true);
    try {
      const result = await listOneDriveFiles({ folderId: 'root' });
      if (result.success) {
        setFiles(result.files);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Button onClick={loadFiles} disabled={loading}>
        {loading ? 'Loading...' : 'Load OneDrive Files'}
      </Button>

      <div className="mt-4">
        {files.map((file) => (
          <div key={file.id} className="p-2 border rounded">
            {file.name}
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Example 2: Auto Sync Management

```tsx
'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { enableAutoSync, getAutoSyncConfigs } from '@/actions/onedrive/config';
import { runAutoSyncOnce } from '@/actions/onedrive/sync';

export default function AutoSyncManager({
  businessId,
}: {
  businessId: string;
}) {
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadConfigs = async () => {
    const result = await getAutoSyncConfigs(businessId);
    if (result.success) {
      setConfigs(result.configs);
    }
  };

  const handleEnableAutoSync = async (folderId: string, folderName: string) => {
    setLoading(true);
    try {
      const result = await enableAutoSync(businessId, {
        itemType: 'folder',
        folderId,
        folderName,
        folderPath: `/${folderName}`,
        syncFrequencyMinutes: 60,
      });

      if (result.success) {
        await loadConfigs(); // Refresh list
      }
    } finally {
      setLoading(false);
    }
  };

  const handleManualSync = async (configId: string) => {
    const result = await runAutoSyncOnce(businessId, configId);
    if (result.success) {
      console.log('Sync completed successfully');
    }
  };

  useEffect(() => {
    loadConfigs();
  }, [businessId]);

  return (
    <div>
      <h2>Auto Sync Configurations</h2>

      {configs.map((config) => (
        <div key={config.id} className="p-4 border rounded mb-2">
          <h3>{config.folder_name || config.file_name}</h3>
          <p>Status: {config.last_sync_status}</p>
          <p>Last sync: {config.last_sync_at}</p>

          <Button
            onClick={() => handleManualSync(config.id)}
            disabled={loading}
          >
            Sync Now
          </Button>
        </div>
      ))}
    </div>
  );
}
```

### Example 3: Streaming File Upload with Progress

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

export default function StreamingUpload({
  businessId,
}: {
  businessId: string;
}) {
  const [progress, setProgress] = useState(0);
  const [currentFile, setCurrentFile] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  const handleStreamingUpload = async (selectedFiles: any[]) => {
    setIsUploading(true);
    setProgress(0);

    try {
      const response = await fetch('/api/documents/onedrive', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          items: selectedFiles,
          businessId,
          importType: 'one-time',
        }),
      });

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.progress !== undefined) {
                setProgress(data.progress);
                setCurrentFile(data.currentFile || '');
              }

              if (data.success !== undefined) {
                // Upload completed
                setProgress(100);
                setCurrentFile('');
              }
            } catch (e) {
              console.error('Failed to parse SSE data:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div>
      {isUploading && (
        <div className="mb-4">
          <div className="mb-2">
            <span>Uploading: {currentFile}</span>
          </div>
          <Progress value={progress} className="w-full" />
          <div className="text-sm text-gray-500 mt-1">
            {progress.toFixed(1)}% complete
          </div>
        </div>
      )}

      <Button onClick={() => handleStreamingUpload([])} disabled={isUploading}>
        {isUploading ? 'Uploading...' : 'Start Upload'}
      </Button>
    </div>
  );
}
```

## 🚨 Important Notes

### Authentication Requirements

All OneDrive operations require valid Microsoft authentication. Make sure users are properly authenticated before calling any OneDrive actions.

```tsx
// Check authentication status
import { getCurrentUser } from '@/lib/auth/auth-server';

const user = await getCurrentUser();
if (!user) {
  // Redirect to login or show auth error
  return;
}
```

### Error Handling

Always implement proper error handling for OneDrive operations:

```tsx
try {
  const result = await someOneDriveAction();
  if (!result.success) {
    // Handle specific error
    if (result.error === 'Microsoft authentication required') {
      // Redirect to Microsoft auth
    } else {
      // Show generic error message
    }
  }
} catch (error) {
  console.error('OneDrive operation failed:', error);
  // Show user-friendly error message
}
```

### Performance Considerations

1. **Pagination**: Use pagination for large file lists
2. **Debouncing**: Debounce search inputs when browsing files
3. **Caching**: Cache file lists when appropriate
4. **Progress Feedback**: Always show progress for long-running operations

### Security Notes

1. **Business ID Validation**: Always validate businessId on the server side
2. **User Permissions**: Ensure users can only access their own business data
3. **File Size Limits**: Respect configured file size limits
4. **File Type Restrictions**: Honor allowed/blocked file extensions

## 🔍 Troubleshooting

### Common Issues

1. **"Auto-sync configuration not found"**

   - Make sure to create auto-sync config before triggering manual sync
   - Use `enableAutoSync` first, then `runAutoSyncOnce`

2. **"Microsoft authentication required"**

   - User needs to reconnect their Microsoft account
   - Redirect to Microsoft OAuth flow

3. **Files not syncing**

   - Check file size limits
   - Verify file extensions are allowed
   - Check exclude patterns

4. **Slow sync performance**
   - Reduce batch size
   - Check network connectivity
   - Monitor server resources

### Debug Information

Enable debug logging to troubleshoot issues:

```tsx
// Add debug logging to your components
console.log('OneDrive operation:', {
  businessId,
  operation: 'sync',
  timestamp: new Date().toISOString(),
});
```

## 📚 Related Documentation

- [Microsoft Graph API Documentation](https://docs.microsoft.com/en-us/graph/)
- [Next.js Server Actions](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions)
- [Supabase Storage Documentation](https://supabase.com/docs/guides/storage)

---

For additional help or questions, please contact the development team or check the codebase for implementation details.
