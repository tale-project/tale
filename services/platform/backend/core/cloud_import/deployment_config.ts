/**
 * Deployment inputs for Knowledge cloud-import OAuth.
 *
 * Redirect URI is fixed by the deployment's configured site origins (same
 * doctrine as connectors: the browser's own origin among them, never a raw
 * `Host`). App credentials resolve in order:
 *   1. CLOUD_IMPORT_MICROSOFT_* / CLOUD_IMPORT_GOOGLE_DRIVE_* (dedicated)
 *   2. AUTH_MICROSOFT_ENTRA_ID_* (login app — Microsoft 365 import only)
 *
 * Microsoft authorize/token URLs must use a tenant-specific path (or
 * `organizations` for multi-tenant apps). `/common` fails AADSTS50194 for
 * single-tenant registrations created after 2018-10-15.
 */

import {
  canonicalOrigin,
  publicBaseUrlFor,
  siteOrigins,
} from '../lib/helpers/public_origin';
import type { CloudImportProvider } from './types';

export const CLOUD_IMPORT_OAUTH_CALLBACK_PATH =
  '/api/cloud-import/oauth2/callback';

export interface OauthAppCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

/**
 * `<origin><BASE_PATH>`, or null when `SITE_URL` is unconfigured. `origin`
 * is the public origin the browser is on; honoured only when it is one of
 * the configured site origins, else the canonical one.
 */
export function resolvePublicBaseUrl(origin?: string | null): string | null {
  const canonical = canonicalOrigin();
  if (canonical === null) return null;
  const chosen =
    origin !== undefined && origin !== null && siteOrigins().includes(origin)
      ? origin
      : canonical;
  return publicBaseUrlFor(chosen);
}

export function resolveCloudImportOauthRedirectUri(
  origin?: string | null,
): string | null {
  const base = resolvePublicBaseUrl(origin);
  return base === null ? null : `${base}${CLOUD_IMPORT_OAUTH_CALLBACK_PATH}`;
}

/**
 * The `<origin><BASE_PATH>` a cloud-import redirect URI we minted was built
 * on, so the callback returns the browser to the domain it started on.
 */
export function publicBaseFromCloudImportRedirectUri(
  redirectUri: string,
): string | null {
  if (!redirectUri.endsWith(CLOUD_IMPORT_OAUTH_CALLBACK_PATH)) return null;
  return redirectUri.slice(0, -CLOUD_IMPORT_OAUTH_CALLBACK_PATH.length);
}

/**
 * Documents page after a successful (or failed) authorization. `base` is the
 * `<origin><BASE_PATH>` of the flow; omitted, the canonical one.
 */
export function resolveDocumentsUrl(
  organizationId: string,
  base: string | null = resolvePublicBaseUrl(),
): string | null {
  return base === null
    ? null
    : `${base}/dashboard/${encodeURIComponent(organizationId)}/documents`;
}

function envPair(idKey: string, secretKey: string): OauthAppCredentials | null {
  const clientId = (process.env[idKey] ?? '').trim();
  const clientSecret = (process.env[secretKey] ?? '').trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * OAuth app for one cloud-import provider, or null when none is configured.
 * Callers log the missing variable *names* only.
 */
export function resolveCloudImportOauthApp(
  provider: CloudImportProvider,
): OauthAppCredentials | null {
  if (provider === 'onedrive') {
    return (
      envPair(
        'CLOUD_IMPORT_MICROSOFT_CLIENT_ID',
        'CLOUD_IMPORT_MICROSOFT_CLIENT_SECRET',
      ) ??
      envPair('AUTH_MICROSOFT_ENTRA_ID_ID', 'AUTH_MICROSOFT_ENTRA_ID_SECRET')
    );
  }
  return envPair(
    'CLOUD_IMPORT_GOOGLE_DRIVE_CLIENT_ID',
    'CLOUD_IMPORT_GOOGLE_DRIVE_CLIENT_SECRET',
  );
}

/**
 * Directory (tenant) ID for Microsoft cloud-import OAuth. Single-tenant app
 * registrations require this — `/common` is rejected (AADSTS50194).
 *
 * Resolution order:
 *   1. CLOUD_IMPORT_MICROSOFT_TENANT_ID
 *   2. AUTH_MICROSOFT_ENTRA_ID_TENANT_ID
 *
 * Callers may also pass an org Entra SSO issuer tenant as a last resort.
 */
export function resolveMicrosoftCloudImportTenantId(): string | null {
  const dedicated = (process.env.CLOUD_IMPORT_MICROSOFT_TENANT_ID ?? '').trim();
  if (dedicated.length > 0) return dedicated;
  const auth = (process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID ?? '').trim();
  return auth.length > 0 ? auth : null;
}

/** Authorize + token endpoints for a Microsoft tenant (or `organizations`). */
export function microsoftCloudImportOauthUrls(tenantId: string): {
  authorizeUrl: string;
  tokenUrl: string;
} {
  const segment = encodeURIComponent(tenantId);
  const base = `https://login.microsoftonline.com/${segment}/oauth2/v2.0`;
  return {
    authorizeUrl: `${base}/authorize`,
    tokenUrl: `${base}/token`,
  };
}

/** Names operators should set when resolve returns null (for server logs). */
export function cloudImportOauthMissingEnvNames(
  provider: CloudImportProvider,
): string {
  if (provider === 'onedrive') {
    return 'CLOUD_IMPORT_MICROSOFT_CLIENT_ID/SECRET + CLOUD_IMPORT_MICROSOFT_TENANT_ID (or AUTH_MICROSOFT_ENTRA_ID_ID/SECRET/TENANT_ID)';
  }
  return 'CLOUD_IMPORT_GOOGLE_DRIVE_CLIENT_ID/SECRET';
}

export function cloudImportMicrosoftTenantMissingEnvNames(): string {
  return 'CLOUD_IMPORT_MICROSOFT_TENANT_ID (or AUTH_MICROSOFT_ENTRA_ID_TENANT_ID)';
}
