/**
 * Pure logic for locating the Better Auth account row that holds a user's
 * Microsoft Graph token.
 *
 * Two providerIds qualify:
 * - `microsoft` — the legacy Better Auth `socialProviders.microsoft` login
 *   (removed with the Entra SSO cutover in #354); rows created by it can
 *   still exist on long-lived deployments.
 * - `entra-id` — the unified Enterprise SSO connection for Microsoft
 *   Entra ID, which stores the Graph access/refresh tokens on every login.
 *
 * Kept free of Convex imports so the account-selection rules are unit-testable.
 */

export const MICROSOFT_PROVIDER_IDS = ['microsoft', 'entra-id'] as const;

export function isMicrosoftProvider(providerId: unknown): boolean {
  return (
    typeof providerId === 'string' &&
    (MICROSOFT_PROVIDER_IDS as readonly string[]).includes(providerId)
  );
}

export interface MicrosoftAccountCandidate {
  providerId?: unknown;
  accessToken?: unknown;
  updatedAt?: unknown;
}

function updatedAtOf(candidate: MicrosoftAccountCandidate): number {
  return typeof candidate.updatedAt === 'number' ? candidate.updatedAt : 0;
}

function hasLiveToken(candidate: MicrosoftAccountCandidate): boolean {
  return (
    typeof candidate.accessToken === 'string' && candidate.accessToken !== ''
  );
}

/**
 * Pick the Microsoft account to use from a user's account rows: a Microsoft
 * provider, preferring a row that still carries an access token, newest
 * first (a user can legitimately have both a legacy `microsoft` row and an
 * `entra-id` row after the SSO cutover).
 */
export function pickMicrosoftAccount<T extends MicrosoftAccountCandidate>(
  accounts: readonly T[],
): T | null {
  const candidates = accounts
    .filter((account) => isMicrosoftProvider(account.providerId))
    .sort((a, b) => updatedAtOf(b) - updatedAtOf(a));
  return candidates.find(hasLiveToken) ?? candidates[0] ?? null;
}

/**
 * Whether the scopes granted with the token include OneDrive/SharePoint read
 * access (`Files.Read`). Microsoft reports scopes either fully qualified
 * (`https://graph.microsoft.com/Files.Read`) or short (`Files.Read`) —
 * match case-insensitively on the permission name.
 *
 * A `null`/empty scope means the row predates scope persistence (legacy
 * `microsoft` rows, or `entra-id` rows written before scopes were stored):
 * treat it as capable rather than hiding a feature that may work.
 */
export function scopeGrantsOneDrive(scope: string | null | undefined): boolean {
  if (scope == null || scope.trim() === '') return true;
  return /files\.read/i.test(scope);
}
