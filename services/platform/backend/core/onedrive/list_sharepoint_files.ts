import { fetchGraphCollection, GRAPH_LIST_MAX_ITEMS } from './graph_collection';

export interface SharePointItem {
  id: string;
  name: string;
  size: number;
  isFolder: boolean;
  mimeType?: string;
  lastModified?: number;
  childCount?: number;
  webUrl?: string;
}

export interface ListSharePointFilesArgs {
  siteId: string;
  driveId: string;
  folderId?: string;
  token: string;
}

export interface ListSharePointFilesResult {
  success: boolean;
  items?: SharePointItem[];
  /** The bound cut the listing: the folder holds more items than were
   * returned. A consumer must not treat the list as whole. */
  truncated?: boolean;
  error?: string;
}

interface GraphDriveItem {
  id: string;
  name: string;
  size?: number;
  file?: {
    mimeType?: string;
  };
  folder?: {
    childCount?: number;
  };
  lastModifiedDateTime?: string;
  webUrl?: string;
}

/**
 * Browse a SharePoint document library folder: every page Graph has,
 * followed through `@odata.nextLink` up to the bound, with `truncated`
 * when the bound cut it. SharePoint never syncs, so nothing heals a short
 * read here later — the one-time import is the only import.
 */
export async function listSharePointFiles(
  args: ListSharePointFilesArgs,
): Promise<ListSharePointFilesResult> {
  try {
    const select =
      '$select=id,name,size,file,folder,lastModifiedDateTime,webUrl&$top=200';
    const url = args.folderId
      ? `https://graph.microsoft.com/v1.0/sites/${args.siteId}/drives/${args.driveId}/items/${args.folderId}/children?${select}`
      : `https://graph.microsoft.com/v1.0/sites/${args.siteId}/drives/${args.driveId}/root/children?${select}`;

    const listed = await fetchGraphCollection<GraphDriveItem>({
      url,
      token: args.token,
      maxItems: GRAPH_LIST_MAX_ITEMS,
    });

    if (!listed.ok) {
      console.error(
        '[listSharePointFiles] API error:',
        listed.status,
        listed.errorText,
      );

      if (listed.status === 403) {
        return {
          success: false,
          error:
            'Access denied. You may not have permission to access this location.',
        };
      }

      if (listed.status === 404) {
        return {
          success: false,
          error: 'Location not found.',
        };
      }

      return {
        success: false,
        error: `Failed to list files: ${listed.status}`,
      };
    }

    const items: SharePointItem[] = listed.items.map((item) => ({
      id: item.id,
      name: item.name,
      size: item.size || 0,
      isFolder: !!item.folder,
      mimeType: item.file?.mimeType,
      lastModified: item.lastModifiedDateTime
        ? new Date(item.lastModifiedDateTime).getTime()
        : undefined,
      childCount: item.folder?.childCount,
      webUrl: item.webUrl,
    }));

    items.sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1;
      if (!a.isFolder && b.isFolder) return 1;
      return a.name.localeCompare(b.name);
    });

    return {
      success: true,
      items,
      truncated: listed.truncated,
    };
  } catch (error) {
    console.error('[listSharePointFiles] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
