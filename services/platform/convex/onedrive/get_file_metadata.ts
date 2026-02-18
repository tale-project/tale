import { fetchJson } from '../../lib/utils/type-cast-helpers';

export interface FileMetadataResult {
  success: boolean;
  data?: {
    hash?: string;
    mimeType?: string;
    size?: number;
  };
  error?: string;
}

export async function getFileMetadata(
  itemId: string,
  token: string,
  siteId?: string,
  driveId?: string,
): Promise<FileMetadataResult> {
  try {
    let url: string;
    if (siteId && driveId) {
      url = `https://graph.microsoft.com/v1.0/sites/${siteId}/drives/${driveId}/items/${itemId}?$select=id,name,size,file`;
    } else {
      url = `https://graph.microsoft.com/v1.0/me/drive/items/${itemId}?$select=id,name,size,file`;
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Failed to get file metadata: ${response.status} ${errorText}`,
      };
    }

    const data = await fetchJson<{
      id: string;
      name: string;
      size?: number;
      file?: {
        mimeType?: string;
        hashes?: {
          sha256Hash?: string;
          sha1Hash?: string;
          quickXorHash?: string;
        };
      };
    }>(response);

    const hash =
      data.file?.hashes?.sha256Hash ||
      data.file?.hashes?.sha1Hash ||
      data.file?.hashes?.quickXorHash;

    return {
      success: true,
      data: {
        hash,
        mimeType: data.file?.mimeType,
        size: data.size,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
