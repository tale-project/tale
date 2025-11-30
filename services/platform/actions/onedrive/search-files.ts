'use server';

import {
  getMicrosoftGraphToken,
  MicrosoftGraphClient,
} from '@/lib/microsoft-graph-client';
import type { DriveItemsResponse } from '@/types/microsoft-graph';

export interface SearchFilesResult {
  success: boolean;
  data?: DriveItemsResponse;
  error?: string;
}

/**
 * Search files in OneDrive using Microsoft Graph API
 * This is a server action that retrieves tokens and calls Microsoft Graph
 */
export async function searchOneDriveFiles(
  query: string,
  _options?: { pageSize?: number },
): Promise<SearchFilesResult> {
  try {
    if (!query || query.trim().length === 0) {
      return {
        success: false,
        error: 'Search query cannot be empty',
      };
    }

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

    // Call Microsoft Graph API to search
    const data = await graphClient.searchFiles(query);

    return {
      success: true,
      data,
    };
  } catch (error) {
    console.error('Error searching OneDrive files:', error);

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
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to search files',
    };
  }
}
