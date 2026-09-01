/**
 * List Google Drive folder contents for sync reconcile.
 */

import { fetchJson } from '../../../lib/utils/type-utils';
import { GOOGLE_FOLDER_MIME, isGoogleWorkspaceMime } from './list_files';

export interface FileItem {
  id: string;
  name: string;
  size: number;
  mimeType?: string;
  lastModified?: number;
  /** Path relative to the listed folder, including the file name. */
  relativePath?: string;
}

export interface ListFolderContentsResult {
  success: boolean;
  files?: Array<FileItem>;
  error?: string;
}

const MAX_RECURSION_DEPTH = 20;
const MAX_PAGES = 500;

interface DriveFileRow {
  id: string;
  name: string;
  size?: string;
  mimeType?: string;
  modifiedTime?: string;
}

async function fetchChildren(
  parentId: string,
  token: string,
): Promise<DriveFileRow[]> {
  const children: DriveFileRow[] = [];
  let pageToken: string | undefined;

  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) {
      throw new Error(
        `Failed to list folder contents: exceeded ${MAX_PAGES} pages for item ${parentId} while still paginating`,
      );
    }

    const params = new URLSearchParams({
      fields: 'nextPageToken, files(id, name, size, mimeType, modifiedTime)',
      pageSize: '100',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      q: `'${parentId.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' in parents and trashed = false`,
    });
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
      throw new Error(
        `Failed to list folder contents: ${response.status} ${errorText}`,
      );
    }

    const body = await fetchJson<{
      nextPageToken?: string;
      files?: DriveFileRow[];
    }>(response);
    children.push(...(body.files ?? []));
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }

  return children;
}

function toFileItem(item: DriveFileRow, pathPrefix?: string): FileItem {
  return {
    id: item.id,
    name: item.name,
    size: item.size ? Number.parseInt(item.size, 10) : 0,
    mimeType: item.mimeType,
    lastModified: item.modifiedTime ? Date.parse(item.modifiedTime) : undefined,
    ...(pathPrefix !== undefined && {
      relativePath: pathPrefix ? `${pathPrefix}/${item.name}` : item.name,
    }),
  };
}

/**
 * List binary-importable files in a Drive folder. Native Docs/Sheets/Slides
 * are skipped (same as the picker). With `recursive`, walks subfolders.
 */
export async function listFolderContents(args: {
  itemId: string;
  token: string;
  recursive?: boolean;
}): Promise<ListFolderContentsResult> {
  try {
    if (!args.recursive) {
      const items = await fetchChildren(args.itemId, args.token);
      return {
        success: true,
        files: items
          .filter(
            (item) =>
              item.mimeType !== GOOGLE_FOLDER_MIME &&
              !isGoogleWorkspaceMime(item.mimeType),
          )
          .map((item) => toFileItem(item)),
      };
    }

    const files: FileItem[] = [];
    const queue: Array<{ itemId: string; prefix: string; depth: number }> = [
      { itemId: args.itemId, prefix: '', depth: 0 },
    ];

    for (let next = queue.shift(); next; next = queue.shift()) {
      const { itemId, prefix, depth } = next;
      const items = await fetchChildren(itemId, args.token);

      for (const item of items) {
        if (item.mimeType === GOOGLE_FOLDER_MIME) {
          if (depth < MAX_RECURSION_DEPTH) {
            queue.push({
              itemId: item.id,
              prefix: prefix ? `${prefix}/${item.name}` : item.name,
              depth: depth + 1,
            });
          }
        } else if (!isGoogleWorkspaceMime(item.mimeType)) {
          files.push(toFileItem(item, prefix));
        }
      }
    }

    return { success: true, files };
  } catch (error) {
    console.error('google_drive.listFolderContents error:', error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Unknown error listing folder contents',
    };
  }
}
