import { fetchJson } from '../../../lib/utils/type-utils';

export interface FileMetadataResult {
  success: boolean;
  data?: {
    hash?: string;
    mimeType?: string;
    size?: number;
    /** Graph `lastModifiedDateTime`, ms — the hash-less change key. */
    modifiedAt?: number;
  };
  error?: string;
  /** Graph returned 404 — the item no longer exists at the source (deleted or
   *  trashed), as opposed to a transient / permission / throttle failure. */
  notFound?: boolean;
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
      url = `https://graph.microsoft.com/v1.0/sites/${siteId}/drives/${driveId}/items/${itemId}?$select=id,name,size,file,lastModifiedDateTime`;
    } else {
      url = `https://graph.microsoft.com/v1.0/me/drive/items/${itemId}?$select=id,name,size,file,lastModifiedDateTime`;
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
        notFound: response.status === 404,
      };
    }

    const data = await fetchJson<{
      id: string;
      name: string;
      size?: number;
      lastModifiedDateTime?: string;
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
        modifiedAt: data.lastModifiedDateTime
          ? Date.parse(data.lastModifiedDateTime)
          : undefined,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
