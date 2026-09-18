/**
 * Cryptographic helpers for SCIM bearer tokens — the SCIM spelling of the
 * shared opaque-token shape (`core/lib/opaque_token.ts`): `scim_` marker,
 * 32 random bytes hex, SHA-256 lookup hash, marker-plus-8 display prefix.
 */

import {
  generateOpaqueToken,
  hashOpaqueToken,
  opaqueTokenPrefix,
} from '../../lib/opaque_token.ts';

const SCIM_TOKEN_MARKER = 'scim_';

/**
 * Generate a SCIM bearer token: `scim_` + 32 random bytes hex (64 chars).
 * Shown to the admin once at generation; only its SHA-256 hash is stored.
 */
export function generateScimToken(): string {
  return generateOpaqueToken(SCIM_TOKEN_MARKER);
}

/** One-way SHA-256 (hex) used to store and look up a token. */
export async function hashScimToken(token: string): Promise<string> {
  return hashOpaqueToken(token);
}

/**
 * Human-facing display prefix for a token: the `scim_` marker plus the first 8
 * hex chars, e.g. `scim_1a2b3c4d…`. Safe to persist and show in the UI.
 */
export function scimTokenPrefix(token: string): string {
  return opaqueTokenPrefix(token, SCIM_TOKEN_MARKER);
}
