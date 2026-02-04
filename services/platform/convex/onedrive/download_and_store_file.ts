import type { Id } from '../_generated/dataModel';

export interface DownloadAndStoreFileArgs {
  itemId: string;
  token: string;
}

export interface DownloadAndStoreFileResult {
  success: boolean;
  storageId?: Id<'_storage'>;
  mimeType?: string;
  error?: string;
}

export interface DownloadAndStoreFileDeps {
  storeFile: (blob: Blob) => Promise<Id<'_storage'>>;
}

export async function downloadAndStoreFile(
  args: DownloadAndStoreFileArgs,
  deps: DownloadAndStoreFileDeps,
): Promise<DownloadAndStoreFileResult> {
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
        error: `Failed to download file: ${response.status} ${errorText}`,
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    const mimeType = response.headers.get('content-type') || 'application/octet-stream';

    const blob = new Blob([arrayBuffer], { type: mimeType });
    const storageId = await deps.storeFile(blob);

    return {
      success: true,
      storageId,
      mimeType,
    };
  } catch (error) {
    console.error('[downloadAndStoreFile] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error downloading file',
    };
  }
}
