/**
 * Pure OAuth2 refresh helpers for cloud-import grants — shared by the 0.4
 * `resolve_token` action and the 0.5 backend's token resolver. Plain
 * fetches against the vendor token endpoints; a non-OK response reads as
 * "refresh failed" (`null`), never a throw — the caller owns the
 * needs-reauth marking.
 */

import { getNumber, getString, isRecord } from '../../../lib/utils/type-utils';
import { microsoftCloudImportOauthUrls } from './deployment_config';
import { getCloudImportProviderEndpoints } from './providers';

export interface RefreshedTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export function parseOAuthTokenResponse(data: unknown): RefreshedTokens | null {
  if (!isRecord(data)) return null;
  const accessToken = getString(data, 'access_token');
  if (accessToken === undefined) return null;
  const refreshToken = getString(data, 'refresh_token');
  const expiresIn = getNumber(data, 'expires_in');
  return {
    accessToken,
    ...(refreshToken !== undefined && { refreshToken }),
    ...(expiresIn !== undefined && {
      expiresAt: Date.now() + expiresIn * 1000,
    }),
  };
}

export async function refreshMicrosoftAccessToken(args: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  tenantId: string;
}): Promise<RefreshedTokens | null> {
  const { tokenUrl } = microsoftCloudImportOauthUrls(args.tenantId);
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: args.clientId,
      client_secret: args.clientSecret,
      refresh_token: args.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!response.ok) return null;
  return parseOAuthTokenResponse(await response.json());
}

export async function refreshGoogleAccessToken(args: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<RefreshedTokens | null> {
  const { tokenUrl } = getCloudImportProviderEndpoints('google-drive');
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: args.clientId,
      client_secret: args.clientSecret,
      refresh_token: args.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!response.ok) return null;
  return parseOAuthTokenResponse(await response.json());
}
