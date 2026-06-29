/**
 * Ship-exclusion rules — files that exist in a skill's source under
 * `.agents/skills/` but must NOT be copied into the generated `.claude/skills/`
 * mirror (unit/spec tests, SOPS secret blobs).
 *
 * Mirrors the skip set in `tools/cli/scripts/generate-embedded.ts` (the CLI
 * embed of `builtin-configs`) so the mirror and the shipped CLI bundle agree on
 * what a skill contains.
 */

/** Directories never walked into (huge / irrelevant / generated). */
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  '.history',
  '_generated',
  'node_modules',
]);

/**
 * Filename suffixes that are source-only and must be stripped from a target:
 * unit/spec tests and SOPS secret blobs.
 *
 * Deliberately does NOT include binary extensions (`.png`, …). `generate-embedded`
 * skips those only because it inlines files as JSON strings into a TS module; the
 * sync writes real files to disk, so a skill's binary asset must reach
 * `builtin-configs/` (the `services/sandbox-runtime` image loads it from disk at
 * chat time). Adding a binary skip here would strip assets from the shipped
 * bundle.
 */
const SKIP_SUFFIXES: readonly string[] = [
  '.test.ts',
  '.test.js',
  '.spec.ts',
  '.secrets.json',
];

/** True if `filename` is source-only and must be excluded from a synced target. */
export function isShipExcluded(filename: string): boolean {
  return SKIP_SUFFIXES.some((suffix) => filename.endsWith(suffix));
}
