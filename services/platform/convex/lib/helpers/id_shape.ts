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
 * Convex document ids are lowercase base-32 strings around 32 characters. The
 * accepted range here is deliberately generous so a future id-length change
 * cannot reject real ids, while still excluding every realistic sentinel,
 * slug (dashes), or email (`@`, dots).
 */
export function looksLikeConvexDocumentId(value: string): boolean {
  return /^[0-9a-z]{20,64}$/.test(value);
}
