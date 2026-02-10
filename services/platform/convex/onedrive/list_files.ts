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
  error?: string;
}

export async function listFiles(
  token: string,
  folderId?: string,
  search?: string,
): Promise<ListFilesResult> {
  try {
    let url: string;

    if (search) {
      const escapedSearch = search.replace(/'/g, "''");
      url = `https://graph.microsoft.com/v1.0/me/drive/root/search(q='${encodeURIComponent(escapedSearch)}')?$top=50`;
    } else if (folderId) {
      url = `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children?$top=100`;
    } else {
      url = `https://graph.microsoft.com/v1.0/me/drive/root/children?$top=100`;
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
        error: `OneDrive API error: ${response.status} ${errorText}`,
      };
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
    const data = (await response.json()) as {
      value: Array<{
        id: string;
        name: string;
        size: number;
        file?: { mimeType?: string };
        folder?: { childCount?: number };
        lastModifiedDateTime?: string;
        webUrl?: string;
      }>;
    };

    const items = data.value.map((item) => ({
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

    return { success: true, items };
  } catch (error) {
    console.error('[listFiles] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
