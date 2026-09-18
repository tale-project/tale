/**
 * Opaque bearer tokens — the one shape every "answered once, hash stored"
 * credential shares (the SCIM token, the trusted-header key): a marker the
 * holder can recognise, 32 random bytes as hex, a SHA-256 hash for the
 * lookup column, and a display prefix that is safe to persist and show.
 *
 * Web Crypto only (`crypto.getRandomValues` / `crypto.subtle`), so the same
 * helpers run wherever the backend does.
 */

/** `<marker>` + 32 random bytes as 64 hex chars. */
export function generateOpaqueToken(marker: string): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const raw = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${marker}${raw}`;
}

/** One-way SHA-256 (hex) used to store and look a token up. */
export async function hashOpaqueToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Human-facing prefix: the marker plus the first 8 hex chars, e.g.
 * `thk_1a2b3c4d…` — enough to tell keys apart, never enough to use one.
 */
export function opaqueTokenPrefix(token: string, marker: string): string {
  return `${token.slice(0, marker.length + 8)}…`;
}
