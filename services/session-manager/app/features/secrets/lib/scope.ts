import type { SecretSummary } from '@/lib/api/schemas';

/**
 * Who a secret is for, as a string a select can hold: every secret (the list's
 * filter only), the secrets for every session, or one session's id. These are
 * the values the API's `scope` parameter takes.
 */
export const SCOPE_ALL = 'all';
export const SCOPE_GLOBAL = 'global';

/** The scope a secret belongs to: `global`, or its session's id. */
export function scopeOf(secret: Pick<SecretSummary, 'session'>): string {
  return secret.session === null ? SCOPE_GLOBAL : String(secret.session.id);
}

/** Whether a secret shows under a scope of the list's filter. */
export function matchesScope(
  secret: Pick<SecretSummary, 'session'>,
  scope: string,
): boolean {
  return scope === SCOPE_ALL || scopeOf(secret) === scope;
}

/** The session a scope names, or null for every session. */
export function sessionIdOfScope(scope: string): number | null {
  if (scope === SCOPE_GLOBAL || scope === SCOPE_ALL) return null;
  const id = Number(scope);
  return Number.isSafeInteger(id) && id >= 1 ? id : null;
}
