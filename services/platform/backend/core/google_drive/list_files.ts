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
  /** The bound cut the listing: the folder (or search) holds more items
   * than were returned. A consumer must not treat the list as whole. */
  truncated?: boolean;
  error?: string;
}

/** The most items one browse/import listing collects before it stops and
 * says so — 100 Drive pages, far past any folder a picker can render (the
 * OneDrive twin's `GRAPH_LIST_MAX_ITEMS`). */
export const DRIVE_LIST_MAX_ITEMS = 10_000;

/** A search answers a picker, not an import — a smaller bound is plenty. */
export const DRIVE_SEARCH_MAX_ITEMS = 500;

/** Fail-safe on the page walk (a nextPageToken cycle); at ≥1 item per page
 * the item bound trips first, so hitting this means Drive is misbehaving. */
const MAX_PAGES = 500;

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * List children of a Drive folder (My Drive), or search the drive: every
 * page Drive has, followed through `nextPageToken` up to the bound, with
 * `truncated` when the bound cut it. Omits native Google Workspace files
 * that cannot be downloaded as binaries; folders stay selectable. An
 * unbounded walk let a short search term over a large tenant (shared
 * drives included) run hundreds of sequential Drive calls inside one HTTP
 * request after a single rate-limit charge.
 */
export async function listFiles(
  token: string,
  folderId?: string,
  search?: string,
): Promise<ListFilesResult> {
  try {
    const parentId = folderId && folderId.length > 0 ? folderId : 'root';
    const searching = search !== undefined && search.trim().length > 0;
    const maxItems = searching ? DRIVE_SEARCH_MAX_ITEMS : DRIVE_LIST_MAX_ITEMS;
    const fields =
      'nextPageToken, files(id, name, size, mimeType, modifiedTime, webViewLink)';
    const items: GoogleDriveItem[] = [];
    let pageToken: string | undefined;

    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES) {
        return { success: true, items, truncated: true };
      }
      const params = new URLSearchParams({
        fields,
        pageSize: '100',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      });
      if (searching) {
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
      if (items.length >= maxItems) {
        // Past the bound: keep exactly the bound and say the folder holds
        // more — whether another page waits, or this one overflowed it.
        const truncated = pageToken !== undefined || items.length > maxItems;
        return { success: true, items: items.slice(0, maxItems), truncated };
      }
      if (!pageToken) break;
    }

    return { success: true, items, truncated: false };
  } catch (error) {
    console.error('[google_drive.listFiles] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
