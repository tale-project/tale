/**
 * Cryptographic helpers for SCIM bearer tokens.
 *
 * Web Crypto (`crypto.getRandomValues` / `crypto.subtle`) is available in the
 * Convex V8 runtime — confirmed by `audit_logs/internal_mutations.ts` and the
 * workflow-trigger token helpers.
 */

/**
 * Generate a SCIM bearer token: `scim_` + 32 random bytes hex (64 chars).
 * Shown to the admin once at generation; only its SHA-256 hash is stored.
 */
export function generateScimToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const raw = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `scim_${raw}`;
}

/** One-way SHA-256 (hex) used to store and look up a token. */
export async function hashScimToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Human-facing display prefix for a token: the `scim_` marker plus the first 8
 * hex chars, e.g. `scim_1a2b3c4d…`. Safe to persist and show in the UI.
 */
export function scimTokenPrefix(token: string): string {
  return `${token.slice(0, 'scim_'.length + 8)}…`;
}
