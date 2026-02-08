/**
 * Cryptographic helpers for workflow triggers.
 * Handles token generation, API key creation, and hashing.
 */

/**
 * Generate a secure random token for webhook URLs.
 * Returns a 32-byte hex string (64 characters).
 */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate a workflow API key with `wfk_` prefix.
 * Returns the full key (shown once to the user).
 */
export function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const raw = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `wfk_${raw}`;
}

/**
 * One-way hash for storing secrets and API keys.
 * Uses SHA-256 for irreversible storage.
 */
export async function hashSecret(secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(secret);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
