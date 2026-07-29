import * as logger from '../../utils/logger';

/**
 * Honest counts for the `tale init` summary. The scaffolded `default/` tree
 * is mostly a passive catalog: an agent or workflow file on disk is only
 * active on a new org when its JSON sets `metadata.autoInstall: true`
 * (checked by the platform's provision_defaults), and bundle domains
 * (connectors, skills) hold several files per entry — so raw file counts
 * read as bloat.
 */

interface AutoInstallCounts {
  /** Entries provisioned on a new org (`metadata.autoInstall: true`). */
  active: number;
  /** Entries that stay in the in-app catalog until installed. */
  catalog: number;
}

function hasAutoInstall(content: string, relPath: string): boolean {
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed === null || typeof parsed !== 'object') return false;
    const metadata = (parsed as { metadata?: unknown }).metadata;
    if (metadata === null || typeof metadata !== 'object') return false;
    return (metadata as { autoInstall?: unknown }).autoInstall === true;
  } catch (err) {
    // Malformed catalog JSON — count it as catalog-only; the platform's
    // provisioner would skip it the same way.
    logger.debug(`could not parse ${relPath} for autoInstall: ${String(err)}`);
    return false;
  }
}

/**
 * Split a domain's `relPath → JSON content` map into active vs catalog by
 * `metadata.autoInstall` (mirrors the platform's provisioning rule).
 */
export function countAutoInstall(
  files: Map<string, string>,
): AutoInstallCounts {
  let active = 0;
  for (const [relPath, content] of files) {
    if (hasAutoInstall(content, relPath)) active++;
  }
  return { active, catalog: files.size - active };
}

/**
 * Count the distinct top-level entries of a bundle domain (one directory per
 * connector or skill, several files each). Embedded paths may carry either
 * separator depending on the build machine, so split on both.
 */
export function countTopLevelEntries(files: Map<string, string>): number {
  const entries = new Set<string>();
  for (const relPath of files.keys()) {
    entries.add(relPath.split(/[\\/]/, 1)[0] ?? relPath);
  }
  return entries.size;
}
