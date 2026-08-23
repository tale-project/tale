import { fetchJson } from '../../lib/utils/type-utils';
import { isGoogleWorkspaceMime } from './list_files';

export interface FileMetadataResult {
  success: boolean;
  data?: {
    hash?: string;
    mimeType?: string;
    size?: number;
  };
  error?: string;
  notFound?: boolean;
}

export async function getFileMetadata(
  itemId: string,
  token: string,
): Promise<FileMetadataResult> {
  try {
    const params = new URLSearchParams({
      fields: 'id,name,size,mimeType,md5Checksum',
      supportsAllDrives: 'true',
    });
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(itemId)}?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      },
    );

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
      size?: string;
      mimeType?: string;
      md5Checksum?: string;
    }>(response);

    if (isGoogleWorkspaceMime(data.mimeType)) {
      return {
        success: false,
        error:
          'Native Google Docs, Sheets, and Slides cannot be imported as binary files',
      };
    }

    return {
      success: true,
      data: {
        hash: data.md5Checksum,
        mimeType: data.mimeType,
        size: data.size ? Number.parseInt(data.size, 10) : undefined,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
