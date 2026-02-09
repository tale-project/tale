export const MICROSOFT_LOGIN_BASE = 'https://login.microsoftonline.com';
export const MICROSOFT_GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export const ONEDRIVE_SCOPES = [
  'https://graph.microsoft.com/Files.Read',
  'https://graph.microsoft.com/Sites.Read.All',
  'offline_access',
];

export const DEFAULT_SCOPES = ['openid', 'profile', 'email', 'offline_access'];

export function extractTenantId(issuer: string): string {
  if (issuer.includes('login.microsoftonline.com')) {
    return issuer.split('/')[3] || 'common';
  }
  return 'common';
}
