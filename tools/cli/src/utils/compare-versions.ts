function extractPrereleaseNumber(tag: string): number {
  const match = tag.match(/(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Compare two semver version strings with optional "v" prefix and prerelease suffixes.
 * Returns: negative if a < b, 0 if equal, positive if a > b.
 */
export function compareVersions(a: string, b: string): number {
  const aBase = a.replace(/^v/, '').split('-')[0];
  const bBase = b.replace(/^v/, '').split('-')[0];

  const aParts = aBase.split('.').map(Number);
  const bParts = bBase.split('.').map(Number);

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aVal = aParts[i] ?? 0;
    const bVal = bParts[i] ?? 0;
    if (aVal !== bVal) return aVal - bVal;
  }

  // Base versions equal — release > prerelease
  const aPrerelease = a.includes('-');
  const bPrerelease = b.includes('-');

  if (!aPrerelease && bPrerelease) return 1;
  if (aPrerelease && !bPrerelease) return -1;

  // Both prerelease: compare numeric suffix (rc16 > rc2)
  const aNum = extractPrereleaseNumber(a);
  const bNum = extractPrereleaseNumber(b);
  if (aNum !== bNum) return aNum - bNum;

  return a.localeCompare(b);
}
