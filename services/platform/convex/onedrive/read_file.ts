/**
 * Read File - Business logic for reading files from OneDrive
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
export async function readFile(args: {
  itemId: string;
  token: string;
}): Promise<ReadFileResult> {
  try {
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

    const arrayBuffer = await response.arrayBuffer();

    const contentType =
      response.headers.get('content-type') || 'application/octet-stream';

    return {
      success: true,
      content: arrayBuffer,
      mimeType: contentType,
      size: arrayBuffer.byteLength,
    };
  } catch (error) {
    console.error('readFile error:', error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'Unknown error reading file',
    };
  }
}
