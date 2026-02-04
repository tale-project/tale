/**
 * SharePoint Drives (Document Libraries) List
 *
 * Lists document libraries within a SharePoint site via Microsoft Graph API.
 */

export interface SharePointDrive {
  id: string;
  name: string;
  driveType: string;
  webUrl?: string;
  description?: string;
}

export interface ListSharePointDrivesArgs {
  siteId: string;
  token: string;
}

export interface ListSharePointDrivesResult {
  success: boolean;
  drives?: SharePointDrive[];
  error?: string;
}

export async function listSharePointDrives(
  args: ListSharePointDrivesArgs,
): Promise<ListSharePointDrivesResult> {
  try {
    const url = `https://graph.microsoft.com/v1.0/sites/${args.siteId}/drives?$select=id,name,driveType,webUrl,description`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${args.token}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[listSharePointDrives] API error:', response.status, errorText);

      if (response.status === 403) {
        return {
          success: false,
          error: 'Access denied. You may not have permission to access this site.',
        };
      }

      if (response.status === 404) {
        return {
          success: false,
          error: 'Site not found.',
        };
      }

      return {
        success: false,
        error: `Failed to list document libraries: ${response.status}`,
      };
    }

    const data = (await response.json()) as {
      value: Array<{
        id: string;
        name: string;
        driveType: string;
        webUrl?: string;
        description?: string;
      }>;
    };

    const drives: SharePointDrive[] = data.value.map((drive) => ({
      id: drive.id,
      name: drive.name,
      driveType: drive.driveType,
      webUrl: drive.webUrl,
      description: drive.description,
    }));

    return {
      success: true,
      drives,
    };
  } catch (error) {
    console.error('[listSharePointDrives] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
