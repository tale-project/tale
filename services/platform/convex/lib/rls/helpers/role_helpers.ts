/**
 * Shared role hierarchy helpers.
 *
 * Owner is a superset of admin — every admin check must also pass for owner.
 * Use `isAdmin` everywhere instead of raw string comparisons.
 */

export function isAdmin(role: string | undefined): boolean {
  const normalized = (role ?? '').toLowerCase();
  return normalized === 'admin' || normalized === 'owner';
}
