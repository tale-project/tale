/**
 * Read File Logic - Business logic for reading files from OneDrive
 */

export interface ReadFileResult {
  success: boolean;
  content?: ArrayBuffer;
  mimeType?: string;
  size?: number;
  error?: string;
}

/**
 * Read file from OneDrive using Microsoft Graph API
 */
export async function readFileLogic(args: {
  itemId: string;
  token: string;
}): Promise<ReadFileResult> {
  try {
    // Call Microsoft Graph API to download file content
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/items/${args.itemId}/content`,
      {
        headers: {
          Authorization: `Bearer ${args.token}`,
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Failed to read file from OneDrive: ${response.status} ${errorText}`,
      };
    }

    // Get file content as ArrayBuffer
    const arrayBuffer = await response.arrayBuffer();

    // Get content type from response headers
    const contentType =
      response.headers.get('content-type') || 'application/octet-stream';

    return {
      success: true,
      content: arrayBuffer,
      mimeType: contentType,
      size: arrayBuffer.byteLength,
    };
  } catch (error) {
    console.error('readFileLogic error:', error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'Unknown error reading file',
    };
  }
}

