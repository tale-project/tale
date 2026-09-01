/**
 * Vendor endpoints and scopes for Knowledge cloud-import OAuth.
 * Catalog lives here (not org connectors) so consent copy and redirect
 * stay purpose-specific: import into Documents, not "connect a connector".
 *
 * Microsoft authorize/token host is tenant-specific — see
 * `microsoftCloudImportOauthUrls` in deployment_config.ts (never `/common`
 * for single-tenant app registrations).
 */

import type { CloudImportProvider } from './types';

export interface CloudImportProviderEndpoints {
  readonly displayName: string;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly scopes: readonly string[];
}

const GOOGLE_DRIVE: CloudImportProviderEndpoints = {
  displayName: 'Google Drive',
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scopes: [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
};

/** Graph scopes for Microsoft 365 (OneDrive + SharePoint) import. */
export const MICROSOFT_CLOUD_IMPORT_SCOPES = [
  'Files.Read',
  'Sites.Read.All',
  'User.Read',
  'offline_access',
] as const;

const PROVIDER_RE = /^(onedrive|google-drive)$/;

export function isCloudImportProvider(
  value: string,
): value is CloudImportProvider {
  return PROVIDER_RE.test(value);
}

export function getCloudImportProviderEndpoints(
  provider: CloudImportProvider,
  microsoftUrls?: { authorizeUrl: string; tokenUrl: string },
): CloudImportProviderEndpoints {
  if (provider === 'onedrive') {
    if (!microsoftUrls) {
      throw new Error(
        'Microsoft cloud-import endpoints require a tenant-specific authorize/token URL',
      );
    }
    return {
      displayName: 'Microsoft 365',
      authorizeUrl: microsoftUrls.authorizeUrl,
      tokenUrl: microsoftUrls.tokenUrl,
      scopes: [...MICROSOFT_CLOUD_IMPORT_SCOPES],
    };
  }
  return GOOGLE_DRIVE;
}
