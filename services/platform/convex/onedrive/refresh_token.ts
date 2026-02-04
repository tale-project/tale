/**
 * Refresh Token - Business logic for refreshing Microsoft OAuth tokens
 */

export interface RefreshTokenResult {
  success: boolean;
  accessToken?: string;
  expiresAt?: number;
  newRefreshToken?: string;
  refreshTokenExpiresAt?: number;
  error?: string;
}

/**
 * Refresh Microsoft OAuth token using refresh token.
 * Pure business logic - does not handle persistence.
 */
export async function refreshToken(args: {
  refreshToken: string;
}): Promise<RefreshTokenResult> {
  try {
    const tenantId = process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID;
    const clientId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
    const clientSecret = process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET;

    if (!tenantId || !clientId || !clientSecret) {
      console.error('refreshToken: Missing OAuth credentials');
      return { success: false, error: 'Missing OAuth credentials' };
    }

    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: args.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('refreshToken: Token refresh failed:', errorText);
      return { success: false, error: `Token refresh failed: ${response.status}` };
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
      refresh_token_expires_in?: number;
    };

    return {
      success: true,
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      newRefreshToken: data.refresh_token,
      refreshTokenExpiresAt: data.refresh_token_expires_in
        ? Date.now() + data.refresh_token_expires_in * 1000
        : undefined,
    };
  } catch (error) {
    console.error('refreshToken: Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
