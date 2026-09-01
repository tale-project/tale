'use node';

/**
 * The ONE hash for subscription-broker token accounting. The turn host stamps
 * `hashBrokerToken(credential.token)` on the run row; the broker resolution
 * excludes pool tokens whose hash matches a stamped one. Both sides MUST use
 * this function — a second implementation that diverges by a byte makes the
 * exclusion silently never match.
 */

import { createHash } from 'node:crypto';

/** sha256 hex (64 chars) of a broker pool token. Accounting only — the
 * plaintext token never persists anywhere. */
export function hashBrokerToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Drop the pool tokens whose hash a failure streak already burned. Advisory
 * by design: when the exclusions would empty the pool, fall back to the FULL
 * pool (`fellBack: true`) — a one-account deployment must retry on its only
 * account, not starve itself on its own bookkeeping.
 */
export function filterBrokerTokensByHash(
  tokens: readonly string[],
  excludedHashes: ReadonlySet<string>,
): { candidates: readonly string[]; fellBack: boolean } {
  if (excludedHashes.size === 0) return { candidates: tokens, fellBack: false };
  const remaining = tokens.filter(
    (token) => !excludedHashes.has(hashBrokerToken(token)),
  );
  if (remaining.length === 0) return { candidates: tokens, fellBack: true };
  return { candidates: remaining, fellBack: false };
}
