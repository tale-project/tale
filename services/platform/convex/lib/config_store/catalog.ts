'use node';

/**
 * Enumerates and reads a config domain's catalog files for an org.
 *
 * The one code path the default-provisioners (prompts; formerly workflows,
 * and still used by the workflows→automations migration while it walks an
 * org's leftover `workflows/` tree) use to read a domain's on-disk catalog:
 * resolve the domain dir via the registry's Layer-B resolver (`./resolvers`),
 * then list every `*.yml` and `*.json` file under it, skipping `.history/`,
 * any other dotfile path segment, and `*.secrets.*` sidecars.
 *
 * YAML-first, per file: when `<base>.yml` and `<base>.json` coexist in the
 * same directory (a tree caught mid-conversion), the `.yml` is authoritative
 * and the `.json` sibling is skipped — the same order every fixed-name
 * reader gets from `read_domain_file.ts`. Callers parse the raw content
 * through the safe YAML loader, which accepts both formats.
 *
 * A missing domain dir surfaces as the `readdir` ENOENT rather than being
 * caught here — callers that race the org scaffold (still copying the
 * catalog into place) retry specifically on that failure, so swallowing it
 * here would make "scaffold still running" indistinguishable from a
 * genuinely empty catalog (which resolves to `[]`).
 */

import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { readFileSafe } from '../file_io';
import { resolveDomainDir } from './resolvers';

export interface CatalogFile {
  /** Path relative to the domain dir, POSIX separators (e.g. `general/hello.yml`). */
  relativePath: string;
  /** Raw file content. */
  content: string;
}

function isConfigFileName(name: string): boolean {
  if (name.endsWith('.secrets.json') || name.endsWith('.secrets.yml')) {
    return false;
  }
  return name.endsWith('.yml') || name.endsWith('.json');
}

export async function listCatalogArea(
  domain: string,
  orgSlug: string,
  opts: { recursive?: boolean } = {},
): Promise<CatalogFile[]> {
  const dir = resolveDomainDir(domain, orgSlug);
  // ENOENT here is intentional — see the file header.
  const entries = await readdir(dir, {
    withFileTypes: true,
    recursive: opts.recursive ?? false,
  });

  const candidates: Array<{ relativePath: string; absPath: string }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !isConfigFileName(entry.name)) continue;

    const parentPath = entry.parentPath ?? dir;
    const relativePath = path
      .relative(dir, path.join(parentPath, entry.name))
      .split(path.sep)
      .join('/');
    // Skip `.history/` and any other dotfile segment anywhere in the path.
    if (relativePath.split('/').some((segment) => segment.startsWith('.'))) {
      continue;
    }
    candidates.push({
      relativePath,
      absPath: path.join(parentPath, entry.name),
    });
  }

  // Mid-conversion shadowing: a `.json` whose `.yml` sibling exists in the
  // same directory is superseded and never listed.
  const yamlBases = new Set(
    candidates
      .filter((c) => c.relativePath.endsWith('.yml'))
      .map((c) => c.relativePath.slice(0, -'.yml'.length)),
  );

  const files: CatalogFile[] = [];
  for (const { relativePath, absPath } of candidates) {
    if (
      relativePath.endsWith('.json') &&
      yamlBases.has(relativePath.slice(0, -'.json'.length))
    ) {
      continue;
    }
    const content = await readFileSafe(absPath);
    if (content === null) continue;
    files.push({ relativePath, content });
  }
  return files;
}
