/**
 * Syntactic pre-check for values about to cross into a component lookup by
 * `_id`.
 *
 * The betterAuth component's adapter runs `db.get(value)` for `_id` filters,
 * and `db.get` THROWS (`Unable to decode ID`) on any string that cannot be a
 * document id. A thrown component query is recorded as an uncaught server
 * error even when the platform-side caller catches the rejection — and to the
 * caller it looks TRANSIENT (it is not an `OrgSlugUnresolvableError`-style
 * terminal miss), so cron reconcilers retry it forever. A sentinel like
 * `'system'`, a slug, or an email in an id-typed field therefore turns into
 * permanent error spam instead of a clean "not found".
 *
 * Two shapes are accepted:
 * - Document ids: alphanumeric, roughly 32 characters. Convex ids are
 *   lowercase base-32; the 0.5 Postgres deployment mints MIXED-CASE Better
 *   Auth ids through the same reused callers, so the class is case-blind.
 *   The length band is deliberately generous so a future id-length change
 *   cannot reject real ids, while still excluding every realistic sentinel
 *   (too short), slug (dashes), or email (`@`, dots).
 * - `convex-test` synthetic ids: `<digits>;<tableName>` (e.g.
 *   `10000;organization`). These are real document ids in the in-process
 *   test backend and must reach `db.get` the same way production ids do.
 */
export function looksLikeConvexDocumentId(value: string): boolean {
  return (
    /^[0-9a-zA-Z]{20,64}$/.test(value) ||
    /^\d+;[a-zA-Z][a-zA-Z0-9_]*$/.test(value)
  );
}
