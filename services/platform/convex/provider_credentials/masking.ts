/**
 * Non-secret display previews for credential secrets. Computed ONCE at write
 * time (inside the `'use node'` actions, where the plaintext briefly exists)
 * and stored on the row, so the V8 list query never touches ciphertext.
 * Pure — unit-testable without Convex.
 */

/** Below this length a first4…last2 preview would reveal most of the secret,
 * so the preview degrades to a fixed placeholder. */
const MIN_MASKABLE_LENGTH = 10;

/** Fixed placeholder for secrets too short to excerpt safely. */
export const MASK_PLACEHOLDER = '••••';

/**
 * The first4…last2 preview of a secret (`sk-o…Z2`), or a fixed placeholder
 * when the secret is too short for an excerpt to be safe. Never returns the
 * input itself.
 */
export function maskSecret(plaintext: string): string {
  const value = plaintext.trim();
  if (value.length < MIN_MASKABLE_LENGTH) return MASK_PLACEHOLDER;
  return `${value.slice(0, 4)}…${value.slice(-2)}`;
}
