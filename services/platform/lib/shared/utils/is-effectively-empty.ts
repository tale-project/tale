/**
 * Treats a value as "effectively empty" for layered i18n resolution.
 *
 * A single source of truth used by both `normalizeAgentConfig` (write path)
 * and `resolveAgentLocale` (read path) so disk invariants and runtime
 * fallbacks stay in lockstep:
 *   - `undefined` / `null` → empty
 *   - strings containing only whitespace → empty
 *   - arrays of length 0, or whose entries are all whitespace strings → empty
 */
export function isEffectivelyEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim().length === 0;
  if (Array.isArray(v)) {
    return (
      v.length === 0 ||
      v.every((el) => typeof el === 'string' && el.trim().length === 0)
    );
  }
  return false;
}
