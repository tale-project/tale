import { compareVersions } from '../../utils/compare-versions';
import * as logger from '../../utils/logger';

interface TagsListResponse {
  name: string;
  tags: string[];
}

interface TokenResponse {
  token: string;
}

export interface VersionInfo {
  tag: string;
  aliases: string[];
}

interface VersionsResult {
  versions: VersionInfo[];
  error?: 'network' | 'unknown';
}

function parseRegistry(registry: string): string | null {
  const match = registry.match(/^ghcr\.io\/(.+)$/);
  if (!match) return null;
  return `${match[1]}/tale-platform`;
}

async function getRegistryToken(image: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://ghcr.io/token?scope=repository:${image}:pull`,
    );

    if (!response.ok) return null;

    const data = (await response.json()) as TokenResponse;
    return data.token && data.token.length > 20 ? data.token : null;
  } catch {
    return null;
  }
}

const ARCH_SUFFIXES = new Set([
  'amd64',
  'arm64',
  'arm',
  '386',
  'ppc64le',
  's390x',
  'mips64le',
  'riscv64',
]);

function isSemanticVersion(tag: string): boolean {
  const match = tag.match(/^v?\d+\.\d+\.\d+(-([a-zA-Z0-9.]+))?$/);
  if (!match) return false;
  if (match[2] && ARCH_SUFFIXES.has(match[2])) return false;
  return true;
}

async function getManifestDigest(
  image: string,
  tag: string,
  token: string,
): Promise<string | null> {
  try {
    const response = await fetch(
      `https://ghcr.io/v2/${image}/manifests/${tag}`,
      {
        method: 'HEAD',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept:
            'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json',
        },
      },
    );
    if (!response.ok) return null;
    return response.headers.get('docker-content-digest');
  } catch {
    return null;
  }
}

function isBranchTag(tag: string): boolean {
  return /^main-[a-f0-9]+$/.test(tag);
}

function sortVersions(tags: string[]): string[] {
  return tags.toSorted((a, b) => compareVersions(b, a));
}

export async function getAvailableVersions(
  registry: string,
  limit = 10,
): Promise<VersionsResult> {
  const image = parseRegistry(registry);
  if (!image) {
    logger.debug(`Cannot parse registry URL: ${registry}`);
    return { versions: [], error: 'unknown' };
  }

  try {
    const token = await getRegistryToken(image);

    if (!token) {
      logger.debug('Failed to get registry token');
      return { versions: [], error: 'network' };
    }

    const response = await fetch(
      `https://ghcr.io/v2/${image}/tags/list?n=1000`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (!response.ok) {
      logger.debug(
        `Failed to fetch tags: ${response.status} ${response.statusText}`,
      );
      return { versions: [], error: 'network' };
    }

    const data = (await response.json()) as TagsListResponse;
    const allTags = data.tags ?? [];

    const versionInfos: VersionInfo[] = [];

    // Get semantic versions sorted
    const semanticTags = allTags.filter(isSemanticVersion);
    const sortedSemanticTags =
      semanticTags.length > 0 ? sortVersions(semanticTags) : [];
    const latestSemanticTag = sortedSemanticTags[0];

    // Check if "latest" points to the same image as the latest semantic version
    const hasLatest = allTags.includes('latest');
    const hasMain = allTags.includes('main');
    let latestMatchesSemanticTag = false;

    if (hasLatest && latestSemanticTag) {
      const [latestDigest, semanticDigest] = await Promise.all([
        getManifestDigest(image, 'latest', token),
        getManifestDigest(image, latestSemanticTag, token),
      ]);
      latestMatchesSemanticTag = !!(
        latestDigest &&
        semanticDigest &&
        latestDigest === semanticDigest
      );
    }

    // Verify manifests exist by lazily probing tags until we have enough
    // published versions (handles runs of recent tags with missing manifests)
    const publishedVersions = new Set<string>();
    for (const tag of sortedSemanticTags) {
      if (publishedVersions.size >= limit) break;
      const hasManifest = !!(await getManifestDigest(image, tag, token));
      if (hasManifest) {
        publishedVersions.add(tag);
      }
    }

    // Build version list
    if (hasLatest) {
      const aliases: string[] = [];
      if (hasMain) aliases.push('main');
      if (latestMatchesSemanticTag && latestSemanticTag)
        aliases.push(latestSemanticTag);
      versionInfos.push({ tag: 'latest', aliases });
    }

    // Add semantic versions (skip the first one if it matches latest)
    const startIndex = latestMatchesSemanticTag ? 1 : 0;
    for (
      let i = startIndex;
      i < sortedSemanticTags.length && versionInfos.length < limit;
      i++
    ) {
      if (!publishedVersions.has(sortedSemanticTags[i])) continue;
      versionInfos.push({ tag: sortedSemanticTags[i], aliases: [] });
    }

    // Fallback to branch tags if no semantic versions
    if (sortedSemanticTags.length === 0) {
      const branchTags = allTags.filter(isBranchTag);
      for (const tag of branchTags) {
        if (versionInfos.length >= limit) break;
        versionInfos.push({ tag, aliases: [] });
      }
    }

    return { versions: versionInfos };
  } catch (err) {
    logger.debug(`Error fetching versions: ${err}`);
    return { versions: [], error: 'network' };
  }
}
