/**
 * List Folder Contents Logic - Business logic for listing OneDrive folder contents
 */

export interface FileItem {
  id: string;
  name: string;
  size: number;
  mimeType?: string;
  lastModified?: number;
}

export interface ListFolderContentsResult {
  success: boolean;
  files?: Array<FileItem>;
  error?: string;
}

/**
 * List files in a OneDrive folder using Microsoft Graph API
 * Only returns files, not subfolders
 */
export async function listFolderContentsLogic(args: {
  itemId: string;
  token: string;
}): Promise<ListFolderContentsResult> {
  try {
    // Call Microsoft Graph API to list folder children
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/items/${args.itemId}/children`,
      {
        headers: {
          Authorization: `Bearer ${args.token}`,
          Accept: 'application/json',
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Failed to list folder contents: ${response.status} ${errorText}`,
      };
    }

    const data = (await response.json()) as {
      value: Array<{
        id: string;
        name: string;
        size: number;
        file?: { mimeType?: string };
        folder?: unknown;
        lastModifiedDateTime?: string;
        fileSystemInfo?: { lastModifiedDateTime?: string };
      }>;
    };

    // Filter to only include files (not subfolders)
    const files = data.value
      .filter((item) => item.file !== undefined)
      .map((item) => {
        const lastModifiedStr =
          item.fileSystemInfo?.lastModifiedDateTime ||
          item.lastModifiedDateTime;
        const lastModified = lastModifiedStr
          ? Date.parse(lastModifiedStr)
          : undefined;
        return {
          id: item.id,
          name: item.name,
          size: item.size,
          mimeType: item.file?.mimeType,
          lastModified,
        };
      });

    return {
      success: true,
      files,
    };
  } catch (error) {
    console.error('listFolderContentsLogic error:', error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Unknown error listing folder contents',
    };
  }
}
