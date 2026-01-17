/**
 * Type definitions for accounts domain
 *
 * Accounts use Better Auth for storage.
 */

// Re-export from shared schemas
export type { OAuthAccount } from '../../lib/shared/schemas/accounts';

// =============================================================================
// INTERFACE TYPES
// =============================================================================

export interface UpdateTokensArgs {
  accountId: string;
  accessToken: string;
  accessTokenExpiresAt: number | null;
  refreshToken?: string;
  refreshTokenExpiresAt?: number | null;
}
