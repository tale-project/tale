import { fetchJson } from '../../../lib/utils/type-utils';

export const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Native Docs/Sheets/Slides — not downloadable as binary via alt=media. */
export function isGoogleWorkspaceMime(mimeType: string | undefined): boolean {
  if (!mimeType) return false;
  if (mimeType === GOOGLE_FOLDER_MIME) return false;
  return mimeType.startsWith('application/vnd.google-apps.');
}

export interface GoogleDriveItem {
  id: string;
  name: string;
  size: number;
  isFolder: boolean;
  mimeType?: string;
  lastModified?: number;
  webUrl?: string;
}

export interface ListFilesResult {
  success: boolean;
  items?: GoogleDriveItem[];
  error?: string;
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * List children of a Drive folder (My Drive). Omits native Google Workspace
 * files that cannot be downloaded as binaries; folders stay selectable.
 */
export async function listFiles(
  token: string,
  folderId?: string,
  search?: string,
): Promise<ListFilesResult> {
  try {
    const parentId = folderId && folderId.length > 0 ? folderId : 'root';
    const fields =
      'nextPageToken, files(id, name, size, mimeType, modifiedTime, webViewLink)';
    const items: GoogleDriveItem[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        fields,
        pageSize: '100',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      });
      if (search && search.trim().length > 0) {
        const q = [
          `name contains '${escapeDriveQueryValue(search.trim())}'`,
          'trashed = false',
        ].join(' and ');
        params.set('q', q);
      } else {
        params.set(
          'q',
          [
            `'${escapeDriveQueryValue(parentId)}' in parents`,
            'trashed = false',
          ].join(' and '),
        );
      }
      if (pageToken) params.set('pageToken', pageToken);

      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
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
          error: `Google Drive API error: ${response.status} ${errorText}`,
        };
      }

      const data = await fetchJson<{
        nextPageToken?: string;
        files?: Array<{
          id: string;
          name: string;
          size?: string;
          mimeType?: string;
          modifiedTime?: string;
          webViewLink?: string;
        }>;
      }>(response);

      for (const file of data.files ?? []) {
        const isFolder = file.mimeType === GOOGLE_FOLDER_MIME;
        if (!isFolder && isGoogleWorkspaceMime(file.mimeType)) {
          continue;
        }
        items.push({
          id: file.id,
          name: file.name,
          size: file.size ? Number.parseInt(file.size, 10) : 0,
          isFolder,
          mimeType: file.mimeType,
          lastModified: file.modifiedTime
            ? Date.parse(file.modifiedTime)
            : undefined,
          webUrl: file.webViewLink,
        });
      }
      pageToken = data.nextPageToken;
    } while (pageToken);

    return { success: true, items };
  } catch (error) {
    console.error('[google_drive.listFiles] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
