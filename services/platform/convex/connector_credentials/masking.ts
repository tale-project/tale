/**
 * Non-secret display previews for connector-credential secrets. Computed
 * ONCE at write time (inside the `'use node'` actions, where the plaintext
 * briefly exists) and stored on the row, so the V8 list query never touches
 * ciphertext. Pure — unit-testable without Convex.
 */

import type { ConnectorSecretPayload } from './auth_injection';

/** Below this length a first4…last2 preview would reveal most of the secret,
 * so the row carries no preview at all. */
const MIN_MASKABLE_LENGTH = 10;

/**
 * The first4…last2 preview of a secret (`ghp_…2Z`), or undefined when the
 * secret is too short for an excerpt to be safe — `maskedPreview` is optional
 * precisely so a short secret can be stored without leaking most of itself.
 * Never returns the input itself.
 */
export function maskSecret(plaintext: string): string | undefined {
  const value = plaintext.trim();
  if (value.length < MIN_MASKABLE_LENGTH) return undefined;
  return `${value.slice(0, 4)}…${value.slice(-2)}`;
}

/**
 * The preview a credential row stores for its method's payload: the single
 * secret for `api-key`/`bearer`, the PASSWORD for `basic` (the username is
 * not secret and shows in full elsewhere), and the ACCESS token for `oauth2`
 * (what the platform actually sends).
 */
export function maskPayload(
  payload: ConnectorSecretPayload,
): string | undefined {
  switch (payload.authMethod) {
    case 'api-key':
    case 'bearer':
      return maskSecret(payload.token);
    case 'basic':
      return maskSecret(payload.password);
    case 'oauth2':
      return maskSecret(payload.accessToken);
    default: {
      const _exhaustive: never = payload;
      return _exhaustive;
    }
  }
}
