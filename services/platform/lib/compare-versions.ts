const SEMVER_RE = /(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)$/;

function extractVersion(tag: string): string | null {
  const m = SEMVER_RE.exec(tag);
  return m ? m[1] : null;
}

function extractPrereleaseNumber(tag: string): number {
  const match = tag.match(/(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Compare two semver version strings with optional prefixes and prerelease suffixes.
 * Accepts `v0.2.8`, `0.2.8`, `cli/v0.2.8`, `@scope/pkg@1.0.0-rc1`, etc.
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

  const aPrerelease = aVer.includes('-');
  const bPrerelease = bVer.includes('-');

  if (!aPrerelease && bPrerelease) return 1;
  if (aPrerelease && !bPrerelease) return -1;

  const aNum = extractPrereleaseNumber(aVer);
  const bNum = extractPrereleaseNumber(bVer);
  if (aNum !== bNum) return aNum - bNum;

  return aVer.localeCompare(bVer);
}

interface ReleaseLike {
  version: string;
}

/**
 * Return releases where `from < version <= to`, descending by version.
 * If `from` is empty or `from >= to`, return only the single release matching `to`.
 */
export function filterReleasesInRange<T extends ReleaseLike>(
  releases: readonly T[],
  from: string | undefined | null,
  to: string,
): T[] {
  const exactMatch = (r: T) => {
    try {
      return compareVersions(r.version, to) === 0;
    } catch (err) {
      console.warn(
        `filterReleasesInRange: unparseable version (${r.version} vs ${to})`,
        err,
      );
      return false;
    }
  };

  if (!from) {
    return releases.filter(exactMatch);
  }

  let cmpFromTo: number;
  try {
    cmpFromTo = compareVersions(from, to);
  } catch (err) {
    console.warn(
      `filterReleasesInRange: unparseable from/to (${from} vs ${to})`,
      err,
    );
    return releases.filter(exactMatch);
  }
  if (cmpFromTo >= 0) {
    return releases.filter(exactMatch);
  }

  const inRange = releases.filter((r) => {
    try {
      return (
        compareVersions(r.version, from) > 0 &&
        compareVersions(r.version, to) <= 0
      );
    } catch (err) {
      console.warn(
        `filterReleasesInRange: unparseable version in range filter (${r.version})`,
        err,
      );
      return false;
    }
  });

  return inRange.sort((a, b) => compareVersions(b.version, a.version));
}
