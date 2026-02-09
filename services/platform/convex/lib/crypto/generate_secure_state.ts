'use node';

import { randomBytes } from 'node:crypto';

/**
 * Generate a cryptographically secure random state string (base64url)
 */
export function generateSecureState(): string {
  return randomBytes(16).toString('base64url');
}
