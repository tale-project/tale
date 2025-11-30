'use server';

import { fetchMutation } from 'convex/nextjs';
import { api } from '@/convex/_generated/api';
import { getAuthToken } from '@/lib/auth/auth-server';

interface EnableAutoSyncParams {
  itemType: 'file' | 'folder';
  fileId?: string;
  fileName?: string;
  filePath?: string;
  folderId?: string;
  folderName?: string;
  folderPath?: string;
  targetBucket: string;
}

interface EnableAutoSyncResult {
  success: boolean;
  data?: {
    id: string;
    itemType: 'file' | 'folder';
    itemId: string;
    itemName: string;
    status: string;
  };
  error?: string;
}

/**
 * Enable auto-sync for a OneDrive file or folder
 */
export async function enableAutoSync(
  organizationId: string,
  params: EnableAutoSyncParams,
): Promise<EnableAutoSyncResult> {
  try {
    // Get authentication token for Convex mutation
    const token = await getAuthToken();
    if (!token) {
      return {
        success: false,
        error: 'Authentication required',
      };
    }

    // Get current user to retrieve userId
    const { getCurrentUser } = await import('@/lib/auth/auth-server');
    const user = await getCurrentUser();
    if (!user) {
      return {
        success: false,
        error: 'User not authenticated',
      };
    }

    if (params.itemType === 'file') {
      if (!params.fileId || !params.fileName) {
        return {
          success: false,
          error: 'File ID and name are required for file sync',
        };
      }

      const result = await fetchMutation(
        api.documents.createOneDriveSyncConfig,
        {
          organizationId: organizationId,
          userId: user._id,
          itemType: 'file',
          itemId: params.fileId,
          itemName: params.fileName,
          itemPath: params.filePath,
          targetBucket: params.targetBucket,
          storagePrefix: `${organizationId}/onedrive`,
        },
        { token },
      );

      if (!result.success || !result.configId) {
        return {
          success: false,
          error: result.error || 'Failed to create sync configuration',
        };
      }

      return {
        success: true,
        data: {
          id: result.configId,
          itemType: 'file',
          itemId: params.fileId,
          itemName: params.fileName,
          status: 'active',
        },
      };
    } else {
      // Folder sync
      if (!params.folderId || !params.folderName) {
        return {
          success: false,
          error: 'Folder ID and name are required for folder sync',
        };
      }

      const result = await fetchMutation(
        api.documents.createOneDriveSyncConfig,
        {
          organizationId: organizationId,
          userId: user._id,
          itemType: 'folder',
          itemId: params.folderId,
          itemName: params.folderName,
          itemPath: params.folderPath,
          targetBucket: params.targetBucket,
          storagePrefix: `${organizationId}/onedrive/${params.folderName}`,
        },
        { token },
      );

      if (!result.success || !result.configId) {
        return {
          success: false,
          error: result.error || 'Failed to create sync configuration',
        };
      }

      return {
        success: true,
        data: {
          id: result.configId,
          itemType: 'folder',
          itemId: params.folderId,
          itemName: params.folderName,
          status: 'active',
        },
      };
    }
  } catch (error) {
    console.error('Error enabling auto-sync:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
