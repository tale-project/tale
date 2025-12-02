'use node';

import { action, internalAction } from './_generated/server';
import { v } from 'convex/values';
import { CompactEncrypt, compactDecrypt } from 'jose';

import { createDebugLog } from './lib/debug_log';

const debugLog = createDebugLog('DEBUG_OAUTH2', '[OAuth2]');

/**
 * OAuth2 Authentication Module
 *
 * Handles OAuth2 flows for any integration (email providers, cloud storage, etc.)
 * Provides token exchange, refresh, storage, and encryption.
 */

// ============================================================================
// Types
// ============================================================================

type OAuth2Provider = 'gmail' | 'microsoft' | 'yahoo' | 'custom';

interface OAuth2Config {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
  scope: string[];
  accountType?: 'personal' | 'organizational' | 'both';
}

// ============================================================================
// Encryption Helpers
// ============================================================================

function base64UrlToBuffer(input: string): Uint8Array {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  if (pad) base64 += '='.repeat(4 - pad);
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function getSecretKey(): Uint8Array {
  const b64 = process.env.ENCRYPTION_SECRET;
  const hex = process.env.ENCRYPTION_SECRET_HEX;

  if (!b64 && !hex) {
    throw new Error(
      'Missing encryption key: set ENCRYPTION_SECRET or ENCRYPTION_SECRET_HEX environment variable',
    );
  }

  const value = b64 || hex;
  const keyBuf = b64 ? base64UrlToBuffer(value!) : hexToUint8Array(value!);

  if (keyBuf.length !== 32) {
    throw new Error(
      `Encryption secret must be 32 bytes. Got ${keyBuf.length} bytes`,
    );
  }

  return keyBuf;
}

async function encryptString(plaintext: string): Promise<string> {
  if (!plaintext) throw new Error('Cannot encrypt empty or null data');

  const secret = getSecretKey();
  const encoder = new TextEncoder();
  const jwe = await new CompactEncrypt(encoder.encode(plaintext))
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .encrypt(secret);

  return jwe;
}

async function decryptString(jwe: string): Promise<string> {
  if (!jwe) throw new Error('Cannot decrypt empty or null data');

  const secret = getSecretKey();
  const { plaintext } = await compactDecrypt(jwe, secret);
  const decoder = new TextDecoder();
  return decoder.decode(plaintext);
}

// ============================================================================
// OAuth2 Configuration Helpers
// ============================================================================

function getOAuth2Config(
  provider: OAuth2Provider,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  accountType?: 'personal' | 'organizational' | 'both',
): OAuth2Config {
  switch (provider) {
    case 'gmail':
      return {
        clientId,
        clientSecret,
        redirectUri,
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        revokeUrl: 'https://oauth2.googleapis.com/revoke',
        scope: ['https://mail.google.com/'],
        accountType,
      };

    case 'microsoft':
      const tenantType =
        accountType === 'personal'
          ? 'consumers'
          : accountType === 'organizational'
            ? 'organizations'
            : 'common';

      return {
        clientId,
        clientSecret,
        redirectUri,
        authUrl: `https://login.microsoftonline.com/${tenantType}/oauth2/v2.0/authorize`,
        tokenUrl: `https://login.microsoftonline.com/${tenantType}/oauth2/v2.0/token`,
        revokeUrl: undefined,
        scope: [
          'https://outlook.office.com/SMTP.Send',
          'https://outlook.office.com/IMAP.AccessAsUser.All',
          'https://graph.microsoft.com/User.Read',
          'https://graph.microsoft.com/Mail.ReadWrite',
          'https://graph.microsoft.com/Mail.Send',
          'offline_access',
        ],
        accountType,
      };

    case 'yahoo':
      return {
        clientId,
        clientSecret,
        redirectUri,
        authUrl: 'https://api.login.yahoo.com/oauth2/request_auth',
        tokenUrl: 'https://api.login.yahoo.com/oauth2/get_token',
        revokeUrl: 'https://api.login.yahoo.com/oauth2/revoke',
        scope: ['mail-w'],
        accountType,
      };

    case 'custom':
      throw new Error('Custom OAuth2 provider requires explicit configuration');

    default:
      throw new Error(`Unsupported OAuth2 provider: ${provider}`);
  }
}

// ============================================================================
// Public Actions
// ============================================================================

/**
 * Exchange OAuth2 authorization code for access tokens
 */
export const exchangeCode = action({
  args: {
    code: v.string(),
    provider: v.string(),
    clientId: v.string(),
    clientSecret: v.string(),
    redirectUri: v.string(),
    accountType: v.optional(
      v.union(
        v.literal('personal'),
        v.literal('organizational'),
        v.literal('both'),
      ),
    ),
  },
  returns: v.object({
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    tokenType: v.string(),
    expiresIn: v.optional(v.number()),
    scope: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const config = getOAuth2Config(
      args.provider as OAuth2Provider,
      args.clientId,
      args.clientSecret,
      args.redirectUri,
      args.accountType,
    );

    // Build token request
    // For Microsoft: Include only Outlook scopes in token exchange (not Graph scopes)
    // to avoid "multiple resources" error. We'll get a separate token for Graph API later.
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code: args.code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });

    // For Microsoft, only include Outlook scopes (single resource)
    if (args.provider === 'microsoft') {
      const outlookScopes = config.scope.filter((s) =>
        s.includes('outlook.office.com'),
      );
      if (outlookScopes.length > 0) {
        tokenParams.set('scope', outlookScopes.join(' '));
      }
    } else {
      // For other providers (Gmail), include all scopes
      tokenParams.set('scope', config.scope.join(' '));
    }

    debugLog('Exchanging OAuth2 code for tokens', {
      provider: args.provider,
      tokenUrl: config.tokenUrl,
      redirectUri: config.redirectUri,
      clientId: config.clientId.substring(0, 10) + '...',
      clientSecretLength: config.clientSecret.length,
      scope: tokenParams.get('scope'),
    });

    // Exchange code for tokens
    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: tokenParams.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OAuth2 token exchange failed', {
        status: response.status,
        error: errorText,
        provider: args.provider,
        clientId: config.clientId.substring(0, 10) + '...',
        redirectUri: config.redirectUri,
      });
      throw new Error(
        `OAuth2 token exchange failed: ${response.status} ${errorText}`,
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      token_type: string;
      expires_in?: number;
      scope?: string;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenType: data.token_type,
      expiresIn: data.expires_in,
      scope: data.scope,
    };
  },
});

/**
 * Refresh OAuth2 access token using refresh token
 */
export const refreshToken = action({
  args: {
    provider: v.string(),
    clientId: v.string(),
    clientSecret: v.string(),
    refreshToken: v.string(),
    scope: v.optional(v.string()),
    accountType: v.optional(v.string()),
    tokenUrl: v.optional(v.string()), // Optional tenant-specific token URL
  },
  returns: v.object({
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    tokenType: v.string(),
    expiresIn: v.optional(v.number()),
    scope: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    // Use provided tokenUrl if available, otherwise generate from config
    let tokenUrl: string;
    if (args.tokenUrl) {
      tokenUrl = args.tokenUrl;
      debugLog('Using stored tenant-specific token URL:', tokenUrl);
    } else {
      const config = getOAuth2Config(
        args.provider as OAuth2Provider,
        args.clientId,
        args.clientSecret,
        '',
        args.accountType as 'personal' | 'organizational' | 'both' | undefined,
      );
      tokenUrl = config.tokenUrl;
      debugLog('Using generated token URL:', tokenUrl);
    }

    // Build refresh request
    const refreshParams = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: args.refreshToken,
      client_id: args.clientId,
      client_secret: args.clientSecret,
    });

    // Optionally request a token for a specific resource (e.g., Graph)
    if (args.scope) {
      refreshParams.set('scope', args.scope);
    }

    // Request new tokens
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: refreshParams.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OAuth2 token refresh failed: ${response.status} ${errorText}`,
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      token_type: string;
      expires_in?: number;
      scope?: string;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || args.refreshToken,
      tokenType: data.token_type,
      expiresIn: data.expires_in,
      scope: data.scope,
    };
  },
});

/**
 * Get user email from OAuth2 provider (provider-specific)
 */
export const getUserEmail = action({
  args: {
    provider: v.string(),
    accessToken: v.string(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    // Gmail-specific implementation
    if (args.provider === 'gmail') {
      try {
        const response = await fetch(
          'https://gmail.googleapis.com/gmail/v1/users/me/profile',
          {
            headers: {
              Authorization: `Bearer ${args.accessToken}`,
            },
          },
        );

        if (!response.ok) {
          return null;
        }

        const profile = (await response.json()) as { emailAddress?: string };
        return profile.emailAddress || null;
      } catch (error) {
        console.error('Failed to fetch Gmail user email:', error);
        return null;
      }
    }

    // Microsoft-specific implementation
    if (args.provider === 'microsoft') {
      try {
        const response = await fetch('https://graph.microsoft.com/v1.0/me', {
          headers: {
            Authorization: `Bearer ${args.accessToken}`,
          },
        });

        if (!response.ok) {
          const body = await response.text();
          console.warn('[OAuth2] Graph /me failed', {
            status: response.status,
            statusText: response.statusText,
            body,
          });
          return null;
        }

        const profile = (await response.json()) as {
          mail?: string;
          userPrincipalName?: string;
        };
        return profile.mail || profile.userPrincipalName || null;
      } catch (error) {
        console.error('Failed to fetch Microsoft user email:', error);
        return null;
      }
    }

    // Provider not supported
    return null;
  },
});

// ============================================================================
// Helper Exports for Internal Use
// ============================================================================

/**
 * Internal action to encrypt a string (used by other modules)
 */
export const encryptStringInternal = internalAction({
  args: {
    plaintext: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    try {
      return await encryptString(args.plaintext);
    } catch (error) {
      console.error('Encryption failed:', error);

      // Provide helpful error message
      if (error instanceof Error) {
        if (error.message.includes('Missing encryption key')) {
          throw new Error(
            'ENCRYPTION_SECRET or ENCRYPTION_SECRET_HEX environment variable is not set in Convex. Please add it in your Convex Dashboard → Settings → Environment Variables.',
          );
        }
        if (error.message.includes('Encryption secret must be 32 bytes')) {
          throw new Error(
            'ENCRYPTION_SECRET is invalid (must be 32 bytes). Please check your environment variable configuration.',
          );
        }
        if (error.message.includes('empty or null')) {
          throw new Error(
            'Cannot encrypt empty data. Please provide valid credentials.',
          );
        }
      }

      throw new Error(
        `Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  },
});

/**
 * Internal action to decrypt a string (used by other modules)
 */
export const decryptStringInternal = internalAction({
  args: {
    encrypted: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    try {
      return await decryptString(args.encrypted);
    } catch (error) {
      console.error('Decryption failed:', error);

      // Provide helpful error message
      if (error instanceof Error) {
        if (error.message.includes('Missing encryption key')) {
          throw new Error(
            'ENCRYPTION_SECRET or ENCRYPTION_SECRET_HEX environment variable is not set in Convex. Please add it in your Convex Dashboard → Settings → Environment Variables.',
          );
        }
        if (error.message.includes('Encryption secret must be 32 bytes')) {
          throw new Error(
            'ENCRYPTION_SECRET is invalid (must be 32 bytes). Please check your environment variable configuration.',
          );
        }
        if (error.message.includes('decrypt')) {
          throw new Error(
            'Decryption failed. This usually means the ENCRYPTION_SECRET has changed since the data was encrypted, or the encrypted data is corrupted. You may need to re-authorize your providers.',
          );
        }
      }

      throw new Error(
        `Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  },
});
