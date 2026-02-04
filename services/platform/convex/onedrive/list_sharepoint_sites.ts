/**
 * SharePoint Sites List
 *
 * Lists SharePoint sites the user has access to via Microsoft Graph API.
 */

export interface SharePointSite {
  id: string;
  name: string;
  displayName: string;
  webUrl: string;
  description?: string;
}

export interface ListSharePointSitesArgs {
  token: string;
  search?: string;
}

export interface ListSharePointSitesResult {
  success: boolean;
  sites?: SharePointSite[];
  error?: string;
}

export async function listSharePointSites(
  args: ListSharePointSitesArgs,
): Promise<ListSharePointSitesResult> {
  try {
    const headers = {
      Authorization: `Bearer ${args.token}`,
      Accept: 'application/json',
    };

    const [searchResult, followedResult, groupsResult] = await Promise.allSettled([
      fetch(
        `https://graph.microsoft.com/v1.0/sites?search=${encodeURIComponent(args.search || '*')}&$select=id,name,displayName,webUrl,description&$top=100`,
        { headers },
      ),
      fetch(
        'https://graph.microsoft.com/v1.0/me/followedSites?$select=id,name,displayName,webUrl,description&$top=100',
        { headers },
      ),
      fetch(
        'https://graph.microsoft.com/v1.0/me/memberOf/microsoft.graph.group?$filter=groupTypes/any(g:g eq \'Unified\')&$select=id,displayName,description&$top=100',
        { headers },
      ),
    ]);

    const sitesMap = new Map<string, SharePointSite>();

    if (searchResult.status === 'fulfilled' && searchResult.value.ok) {
      const data = (await searchResult.value.json()) as {
        value: Array<{
          id: string;
          name?: string;
          displayName?: string;
          webUrl: string;
          description?: string;
        }>;
      };
      for (const site of data.value) {
        const siteName = site.name || site.displayName || 'Unnamed Site';
        sitesMap.set(site.id, {
          id: site.id,
          name: siteName,
          displayName: site.displayName || siteName,
          webUrl: site.webUrl,
          description: site.description,
        });
      }
    }

    if (followedResult.status === 'fulfilled' && followedResult.value.ok) {
      const data = (await followedResult.value.json()) as {
        value: Array<{
          id: string;
          name?: string;
          displayName?: string;
          webUrl: string;
          description?: string;
        }>;
      };
      for (const site of data.value) {
        if (!sitesMap.has(site.id)) {
          const siteName = site.name || site.displayName || 'Unnamed Site';
          sitesMap.set(site.id, {
            id: site.id,
            name: siteName,
            displayName: site.displayName || siteName,
            webUrl: site.webUrl,
            description: site.description,
          });
        }
      }
    }

    if (groupsResult.status === 'fulfilled' && groupsResult.value.ok) {
      const groupsData = (await groupsResult.value.json()) as {
        value: Array<{
          id: string;
          displayName: string;
          description?: string;
        }>;
      };

      const groupSitePromises = groupsData.value.slice(0, 20).map(async (group) => {
        try {
          const siteResponse = await fetch(
            `https://graph.microsoft.com/v1.0/groups/${group.id}/sites/root?$select=id,name,displayName,webUrl,description`,
            { headers },
          );
          if (siteResponse.ok) {
            const site = (await siteResponse.json()) as {
              id: string;
              name?: string;
              displayName?: string;
              webUrl: string;
              description?: string;
            };
            const siteName = site.name || site.displayName || group.displayName;
            return {
              id: site.id,
              name: siteName,
              displayName: site.displayName || group.displayName,
              webUrl: site.webUrl,
              description: site.description || group.description,
            };
          }
        } catch {
          // Group may not have a site, skip silently
        }
        return null;
      });

      const groupSites = await Promise.all(groupSitePromises);
      for (const site of groupSites) {
        if (site && !sitesMap.has(site.id)) {
          sitesMap.set(site.id, site);
        }
      }
    }

    if (sitesMap.size === 0) {
      if (
        searchResult.status === 'fulfilled' &&
        searchResult.value.status === 403
      ) {
        return {
          success: false,
          error: 'Access denied. You may not have permission to access SharePoint sites.',
        };
      }
    }

    const sites = Array.from(sitesMap.values());

    return {
      success: true,
      sites,
    };
  } catch (error) {
    console.error('[listSharePointSites] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
