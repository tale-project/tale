/**
 * The migration baseline: the version whose deployments the empty upgrade
 * chain models. 0.4.0 is a breaking cutover — no migration path exists from
 * earlier releases (fresh deploy only; 0.3.x hotfixes live on `release/0.3`),
 * so the runnable history starts empty here and only future `>= 0.4.x`
 * migrations are ever registered.
 *
 * Single source of truth consumed by:
 *   - the test corpus (`testing/chain.test.ts`, `testing/versions.test.ts`)
 *     as the seeded world's version;
 *   - `scripts/dump-version-schemas.ts` as the in-development checkpoint
 *     version when no `versions/` folder exceeds it;
 *   - the breaking-cutover guard (deploy preflight + boot backstop), which
 *     refuses to run against data whose ledger frontier predates it.
 *
 * Bump ONLY at the next breaking cutover that re-empties the history.
 */
export const BASELINE_VERSION = '0.4.0';
