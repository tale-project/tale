/**
 * List Folder Contents - Business logic for listing OneDrive folder contents
 */

import { fetchJson } from '../../lib/utils/type-utils';

export interface FileItem {
  id: string;
  name: string;
  size: number;
  mimeType?: string;
  lastModified?: number;
  /** Path relative to the listed folder, including the file name
   *  (`Reports/2026/summary.pdf`). Only set when listing recursively. */
  relativePath?: string;
}

export interface ListFolderContentsResult {
  success: boolean;
  files?: Array<FileItem>;
  error?: string;
}

/** Matches the folder-tree cap enforced by the folders domain
 *  (MAX_FOLDER_DEPTH) so a sync can never build a deeper chain than the
 *  create mutation would allow. */
const MAX_RECURSION_DEPTH = 20;

interface DriveItemResponse {
  value: Array<{
    id: string;
    name: string;
    size: number;
    file?: { mimeType?: string };
    folder?: unknown;
    lastModifiedDateTime?: string;
    fileSystemInfo?: { lastModifiedDateTime?: string };
  }>;
}

async function fetchChildren(
  itemId: string,
  token: string,
): Promise<DriveItemResponse['value']> {
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${itemId}/children`,
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

  return (await fetchJson<DriveItemResponse>(response)).value;
}

function toFileItem(
  item: DriveItemResponse['value'][number],
  pathPrefix?: string,
): FileItem {
  const lastModifiedStr =
    item.fileSystemInfo?.lastModifiedDateTime || item.lastModifiedDateTime;
  return {
    id: item.id,
    name: item.name,
    size: item.size,
    mimeType: item.file?.mimeType,
    lastModified: lastModifiedStr ? Date.parse(lastModifiedStr) : undefined,
    ...(pathPrefix !== undefined && {
      relativePath: pathPrefix ? `${pathPrefix}/${item.name}` : item.name,
    }),
  };
}

/**
 * List files in a OneDrive folder using Microsoft Graph API.
 * Only returns files, not subfolders. With `recursive`, walks subfolders
 * (bounded by MAX_RECURSION_DEPTH) and stamps every file's `relativePath`.
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
          .filter((item) => item.file !== undefined)
          .map((item) => toFileItem(item)),
      };
    }

    const files: FileItem[] = [];
    // Queue of folders to expand, each with the path prefix its children get.
    const queue: Array<{ itemId: string; prefix: string; depth: number }> = [
      { itemId: args.itemId, prefix: '', depth: 0 },
    ];

    for (let next = queue.shift(); next; next = queue.shift()) {
      const { itemId, prefix, depth } = next;
      const items = await fetchChildren(itemId, args.token);

      for (const item of items) {
        if (item.file !== undefined) {
          files.push(toFileItem(item, prefix));
        } else if (item.folder !== undefined && depth < MAX_RECURSION_DEPTH) {
          queue.push({
            itemId: item.id,
            prefix: prefix ? `${prefix}/${item.name}` : item.name,
            depth: depth + 1,
          });
        }
      }
    }

    return { success: true, files };
  } catch (error) {
    console.error('listFolderContents error:', error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Unknown error listing folder contents',
    };
  }
}
