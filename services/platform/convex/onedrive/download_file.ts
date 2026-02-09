export interface DownloadFileResult {
  success: boolean;
  content?: ArrayBuffer;
  mimeType?: string;
  error?: string;
}

export async function downloadFile(
  itemId: string,
  token: string,
  siteId?: string,
  driveId?: string,
): Promise<DownloadFileResult> {
  try {
    let url: string;
    if (siteId && driveId) {
      url = `https://graph.microsoft.com/v1.0/sites/${siteId}/drives/${driveId}/items/${itemId}/content`;
    } else {
      url = `https://graph.microsoft.com/v1.0/me/drive/items/${itemId}/content`;
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Failed to download file: ${response.status} ${errorText}`,
      };
    }

    const content = await response.arrayBuffer();
    const mimeType =
      response.headers.get('content-type') || 'application/octet-stream';

    return {
      success: true,
      content,
      mimeType,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
