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
  error?: string;
}

export async function listSharePointFiles(
  args: ListSharePointFilesArgs,
): Promise<ListSharePointFilesResult> {
  try {
    let url: string;

    if (args.folderId) {
      url = `https://graph.microsoft.com/v1.0/sites/${args.siteId}/drives/${args.driveId}/items/${args.folderId}/children?$select=id,name,size,file,folder,lastModifiedDateTime,webUrl&$top=200`;
    } else {
      url = `https://graph.microsoft.com/v1.0/sites/${args.siteId}/drives/${args.driveId}/root/children?$select=id,name,size,file,folder,lastModifiedDateTime,webUrl&$top=200`;
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${args.token}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        '[listSharePointFiles] API error:',
        response.status,
        errorText,
      );

      if (response.status === 403) {
        return {
          success: false,
          error:
            'Access denied. You may not have permission to access this location.',
        };
      }

      if (response.status === 404) {
        return {
          success: false,
          error: 'Location not found.',
        };
      }

      return {
        success: false,
        error: `Failed to list files: ${response.status}`,
      };
    }

    const data = (await response.json()) as {
      value: Array<{
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
      }>;
    };

    const items: SharePointItem[] = data.value.map((item) => ({
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
    };
  } catch (error) {
    console.error('[listSharePointFiles] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
