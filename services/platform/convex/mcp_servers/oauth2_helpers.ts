'use node';

/**
 * OAuth2 token helpers for MCP server authentication.
 *
 * Handles client_credentials grants and token refresh for OAuth2-authenticated
 * MCP server connections.
 */

import { decryptString } from '../lib/crypto/decrypt_string';
import { encryptString } from '../lib/crypto/encrypt_string';

interface OAuth2Config {
  clientId: string;
  clientSecretEncrypted: string;
  tokenUrl: string;
  authorizationUrl?: string;
  scopes?: string[];
  grantType: 'client_credentials' | 'authorization_code';
}

interface OAuth2Tokens {
  accessTokenEncrypted: string;
  refreshTokenEncrypted?: string;
  tokenExpiry?: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
  scope?: string;
}

interface GetOrRefreshResult {
  accessToken: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted?: string;
  tokenExpiry?: number;
}

/**
 * Get a valid access token, refreshing or fetching a new one if necessary.
 *
 * - If existing tokens are present and not expired, decrypts and returns them.
 * - If tokens are expired and a refresh token is available, performs a refresh.
 * - Otherwise, performs a client_credentials grant to obtain new tokens.
 */
export async function getOrRefreshToken(
  config: OAuth2Config,
  tokens?: OAuth2Tokens,
): Promise<GetOrRefreshResult> {
  const now = Math.floor(Date.now() / 1000);

  // If we have a non-expired token, just decrypt and return it
  if (
    tokens?.accessTokenEncrypted &&
    tokens.tokenExpiry != null &&
    now < tokens.tokenExpiry - 300
  ) {
    const accessToken = await decryptString(tokens.accessTokenEncrypted);
    return {
      accessToken,
      accessTokenEncrypted: tokens.accessTokenEncrypted,
      refreshTokenEncrypted: tokens.refreshTokenEncrypted,
      tokenExpiry: tokens.tokenExpiry,
    };
  }

  const clientSecret = await decryptString(config.clientSecretEncrypted);

  // Try refresh if we have a refresh token
  if (tokens?.refreshTokenEncrypted) {
    const refreshToken = await decryptString(tokens.refreshTokenEncrypted);

    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15_000),
    });

    if (response.ok) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- OAuth2 token response shape is guaranteed by the spec
      const data = (await response.json()) as TokenResponse;
      return await encryptTokenResponse(data, tokens.refreshTokenEncrypted);
    }

    // Refresh failed — fall through to new token request
  }

  // Perform client_credentials grant
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
  });

  if (config.scopes?.length) {
    body.set('scope', config.scopes.join(' '));
  }

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `OAuth2 token request failed (${response.status}): ${errorText}`,
    );
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- OAuth2 token response shape is guaranteed by the spec
  const data = (await response.json()) as TokenResponse;
  return await encryptTokenResponse(data);
}

async function encryptTokenResponse(
  data: TokenResponse,
  existingRefreshTokenEncrypted?: string,
): Promise<GetOrRefreshResult> {
  const now = Math.floor(Date.now() / 1000);

  const accessTokenEncrypted = await encryptString(data.access_token);
  const refreshTokenEncrypted = data.refresh_token
    ? await encryptString(data.refresh_token)
    : existingRefreshTokenEncrypted;
  const tokenExpiry = data.expires_in ? now + data.expires_in : undefined;

  return {
    accessToken: data.access_token,
    accessTokenEncrypted,
    refreshTokenEncrypted,
    tokenExpiry,
  };
}
