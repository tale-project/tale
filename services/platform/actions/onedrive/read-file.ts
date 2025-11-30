'use server';

import {
  getMicrosoftGraphToken,
  MicrosoftGraphClient,
} from '@/lib/microsoft-graph-client';

export interface ReadFileResult {
  success: boolean;
  data?: {
    content: string | ArrayBuffer;
    mimeType: string;
    size: number;
  };
  error?: string;
}

/**
 * Read file content from OneDrive using Microsoft Graph API
 * This is a server action that retrieves tokens and calls Microsoft Graph
 */
export async function readOneDriveFile(
  fileId: string,
  options?: { asText?: boolean },
): Promise<ReadFileResult> {
  try {
    // Get Microsoft Graph token (server-side only)
    const token = await getMicrosoftGraphToken();

    if (!token) {
      return {
        success: false,
        error:
          'Microsoft account not connected. Please sign in with Microsoft.',
      };
    }

    // Create Microsoft Graph client with token
    const graphClient = new MicrosoftGraphClient(token);

    // Call Microsoft Graph API to read file
    const content = await graphClient.readFile(fileId);

    // Determine mime type from file extension or default
    const mimeType = 'application/octet-stream';

    // Convert to text if requested
    let fileContent: string | ArrayBuffer = content;
    if (options?.asText) {
      const decoder = new TextDecoder('utf-8');
      fileContent = decoder.decode(content);
    }

    return {
      success: true,
      data: {
        content: fileContent,
        mimeType,
        size: content.byteLength,
      },
    };
  } catch (error) {
    console.error('Error reading OneDrive file:', error);

    // Check for specific error types
    if (error instanceof Error) {
      if (
        error.message.includes('401') ||
        error.message.includes('unauthorized')
      ) {
        return {
          success: false,
          error: 'Microsoft account authentication expired. Please reconnect.',
        };
      }

      if (
        error.message.includes('403') ||
        error.message.includes('forbidden')
      ) {
        return {
          success: false,
          error: 'Permission denied. Please grant access to OneDrive files.',
        };
      }

      if (error.message.includes('404')) {
        return {
          success: false,
          error: 'File not found.',
        };
      }
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to read file',
    };
  }
}
