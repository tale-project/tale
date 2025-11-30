'use server';

import { fetchAction } from 'convex/nextjs';
import { api } from '@/convex/_generated/api';
import { getAuthToken } from '@/lib/auth/auth-server';

interface UploadFileToStorageParams {
  filePath: string;
  fileBuffer: ArrayBuffer;
  contentType?: string;
  metadata?: Record<string, unknown>;
}

interface UploadFileToStorageResult {
  success: boolean;
  filePath?: string;
  fileId?: string;
  documentId?: string;
  error?: string;
}

/**
 * Upload a file to Convex storage and create a document record
 */
export async function uploadFileToStorage({
  filePath,
  fileBuffer,
  contentType = 'application/octet-stream',
  metadata = {},
}: UploadFileToStorageParams): Promise<UploadFileToStorageResult> {
  try {
    // Get authentication token
    const token = await getAuthToken();
    if (!token) {
      return {
        success: false,
        error: 'Not authenticated',
      };
    }

    // Extract organization ID from file path (format: {organizationId}/...)
    const pathParts = filePath.split('/');
    const organizationId = pathParts[0];

    if (!organizationId) {
      return {
        success: false,
        error: 'Invalid file path: organization ID not found',
      };
    }

    // Extract file name from path
    const fileName = pathParts[pathParts.length - 1];

    // Call consolidated Convex action to upload file with authentication token
    const result = await fetchAction(
      api.documents.uploadFile,
      {
        organizationId: organizationId,
        fileName,
        fileData: fileBuffer,
        contentType,
        metadata: {
          ...metadata,
          storagePath: filePath, // Include storage path in metadata
        },
      },
      { token },
    );

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'Failed to upload file',
      };
    }

    return {
      success: true,
      filePath,
      fileId: result.fileId,
      documentId: result.documentId,
    };
  } catch (error) {
    console.error('Error in uploadFileToStorage:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
