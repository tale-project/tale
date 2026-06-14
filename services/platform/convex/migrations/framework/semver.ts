/**
 * Pure semver helpers for the migration framework. No Convex / node deps so
 * this is safe to import from V8 and node contexts alike, and trivially
 * unit-testable.
 *
 * Migrations are ordered by a compound key: the semver they shipped in, then
 * the per-semver numeric id (which restarts at 1 in every version folder). We
 * encode that compound key as a zero-padded string so plain lexicographic
 * comparison yields the canonical global order — the runner never has to sort
 * with a custom comparator at call sites.
 */

/** A parsed `major.minor.patch` triple. */
export interface SemverParts {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const SEMVER_REGEX = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * Parse `"0.2.85"` (optionally `"v0.2.85"`) into its numeric parts. Throws on
 * anything that is not a clean three-segment release — pre-release / build
 * suffixes are intentionally unsupported because migrations only ever ship in
 * tagged releases.
 */
export function parseSemver(input: string): SemverParts {
  const normalized = input.startsWith('v') ? input.slice(1) : input;
  const match = SEMVER_REGEX.exec(normalized);
  if (!match) {
    throw new Error(
      `Invalid semver "${input}". Expected "major.minor.patch" (e.g. "0.2.85").`,
    );
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/** Normalize any accepted spelling to the canonical `"0.2.85"` form. */
export function normalizeSemver(input: string): string {
  const { major, minor, patch } = parseSemver(input);
  return `${major}.${minor}.${patch}`;
}

/** Negative if a<b, 0 if equal, positive if a>b. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  return pa.major - pb.major || pa.minor - pb.minor || pa.patch - pb.patch;
}

const SEGMENT_WIDTH = 6;

function pad(value: number): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `orderKey segment must be a non-negative integer: ${value}`,
    );
  }
  return String(value).padStart(SEGMENT_WIDTH, '0');
}

/**
 * Build the zero-padded global ordering key for a migration. Lexicographic
 * comparison of these strings == canonical (semver, numericId) order.
 *
 * `orderKey("0.2.85", 1)` → `"000000.000002.000085.000001"`.
 */
export function buildOrderKey(semver: string, numericId: number): string {
  const { major, minor, patch } = parseSemver(semver);
  return [major, minor, patch, numericId].map(pad).join('.');
}
