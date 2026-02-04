import type { EntraGroup } from './types';

export async function fetchEntraGroups(
  accessToken: string,
): Promise<EntraGroup[]> {
  const response = await fetch(
    'https://graph.microsoft.com/v1.0/me/memberOf?$select=id,displayName',
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Graph API error: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();

  return (data.value || [])
    .filter(
      (member: { '@odata.type'?: string }) =>
        member['@odata.type'] === '#microsoft.graph.group',
    )
    .map((group: { id: string; displayName: string }) => ({
      id: group.id,
      displayName: group.displayName,
    }));
}
