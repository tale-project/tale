/**
 * List Folder Contents - Business logic for listing OneDrive folder contents
 */

import { fetchJson } from '../../../lib/utils/type-utils';

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
  '@odata.nextLink'?: string;
}

/**
 * Fail-safe bound on the page walk. Graph `/children` returns ~200 items per
 * page, so this covers ~100k direct children in one folder — far past any real
 * synced folder. Hitting it means something is wrong (a nextLink cycle); we
 * THROW rather than truncate, because a truncated listing makes reconcile prune
 * the un-listed documents. Failing the sync is safe; a silent short read is not.
 */
const MAX_PAGES = 500;

async function fetchChildren(
  itemId: string,
  token: string,
): Promise<DriveItemResponse['value']> {
  const children: DriveItemResponse['value'] = [];
  // Graph paginates `/children` with an absolute `@odata.nextLink`; follow it
  // to the end so large folders list in full. Without this, only the first
  // page returns and every later item looks deleted to the sync reconcile.
  let url: string | undefined =
    `https://graph.microsoft.com/v1.0/me/drive/items/${itemId}/children`;

  for (let page = 0; url; page++) {
    if (page >= MAX_PAGES) {
      throw new Error(
        `Failed to list folder contents: exceeded ${MAX_PAGES} pages for item ${itemId} while still paginating`,
      );
    }

    const response: Response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to list folder contents: ${response.status} ${errorText}`,
      );
    }

    const body: DriveItemResponse =
      await fetchJson<DriveItemResponse>(response);
    children.push(...body.value);
    url = body['@odata.nextLink'];
  }

  return children;
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
    // Graph can omit `size` for a freshly copied/uploaded item; floor it to a
    // real number like the picker (`list_files`) and SharePoint listers do.
    size: item.size || 0,
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
