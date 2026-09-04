import { fetchGraphCollection, GRAPH_LIST_MAX_ITEMS } from './graph_collection';

export interface OneDriveItem {
  id: string;
  name: string;
  size: number;
  isFolder: boolean;
  mimeType?: string;
  lastModified?: number;
  childCount?: number;
  webUrl?: string;
}

export interface ListFilesResult {
  success: boolean;
  items?: OneDriveItem[];
  /** The bound cut the listing: the folder (or search) holds more items
   * than were returned. A consumer must not treat the list as whole. */
  truncated?: boolean;
  error?: string;
}

/** A search answers a picker, not an import — a smaller bound is plenty. */
export const ONEDRIVE_SEARCH_MAX_ITEMS = 500;

interface GraphDriveItem {
  id: string;
  name: string;
  size: number;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
  lastModifiedDateTime?: string;
  webUrl?: string;
}

/**
 * Browse a OneDrive folder (or search the drive): every page Graph has,
 * followed through `@odata.nextLink` up to the bound, with `truncated` when
 * the bound cut it. The import dialog expands selected folders through
 * this, so a short read here silently shrank a one-time import.
 */
export async function listFiles(
  token: string,
  folderId?: string,
  search?: string,
): Promise<ListFilesResult> {
  try {
    let url: string;
    let maxItems = GRAPH_LIST_MAX_ITEMS;

    if (search) {
      const escapedSearch = search.replace(/'/g, "''");
      url = `https://graph.microsoft.com/v1.0/me/drive/root/search(q='${encodeURIComponent(escapedSearch)}')?$top=200`;
      maxItems = ONEDRIVE_SEARCH_MAX_ITEMS;
    } else if (folderId) {
      url = `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children?$top=200`;
    } else {
      url = `https://graph.microsoft.com/v1.0/me/drive/root/children?$top=200`;
    }

    const listed = await fetchGraphCollection<GraphDriveItem>({
      url,
      token,
      maxItems,
    });
    if (!listed.ok) {
      return {
        success: false,
        error: `OneDrive API error: ${listed.status} ${listed.errorText}`,
      };
    }

    const items = listed.items.map((item) => ({
      id: item.id,
      name: item.name,
      size: item.size || 0,
      isFolder: item.folder !== undefined,
      mimeType: item.file?.mimeType,
      lastModified: item.lastModifiedDateTime
        ? Date.parse(item.lastModifiedDateTime)
        : undefined,
      childCount: item.folder?.childCount,
      webUrl: item.webUrl,
    }));

    return { success: true, items, truncated: listed.truncated };
  } catch (error) {
    console.error('[listFiles] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
