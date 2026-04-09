const SEMVER_RE = /(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)$/;

/**
 * Extract a semver version string from an arbitrary tag.
 *
 * Handles plain versions (`0.2.8`), v-prefixed (`v0.2.8`), scoped tags
 * (`cli/v0.2.8`, `@tale/cli@0.2.8`), and prerelease suffixes (`v1.0.0-rc1`).
 *
 * Returns `null` when no semver version can be found.
 */
export function extractVersion(tag: string): string | null {
  const m = SEMVER_RE.exec(tag);
  return m ? m[1] : null;
}

function extractPrereleaseNumber(tag: string): number {
  const match = tag.match(/(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Compare two semver version strings with optional prefixes and prerelease suffixes.
 *
 * Accepts any format supported by {@link extractVersion} (e.g. `v0.2.8`,
 * `cli/v0.2.8`, `@scope/pkg@1.0.0-rc1`).
 *
 * Returns: negative if a < b, 0 if equal, positive if a > b.
 */
export function compareVersions(a: string, b: string): number {
  const aVer = extractVersion(a);
  const bVer = extractVersion(b);

  if (!aVer || !bVer) {
    throw new Error(
      `Cannot compare versions: unable to extract semver from "${!aVer ? a : b}"`,
    );
  }

  const aBase = aVer.split('-')[0];
  const bBase = bVer.split('-')[0];

  const aParts = aBase.split('.').map(Number);
  const bParts = bBase.split('.').map(Number);

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aVal = aParts[i] ?? 0;
    const bVal = bParts[i] ?? 0;
    if (aVal !== bVal) return aVal - bVal;
  }

  // Base versions equal — release > prerelease
  const aPrerelease = aVer.includes('-');
  const bPrerelease = bVer.includes('-');

  if (!aPrerelease && bPrerelease) return 1;
  if (aPrerelease && !bPrerelease) return -1;

  // Both prerelease: compare numeric suffix (rc16 > rc2)
  const aNum = extractPrereleaseNumber(aVer);
  const bNum = extractPrereleaseNumber(bVer);
  if (aNum !== bNum) return aNum - bNum;

  return aVer.localeCompare(bVer);
}
