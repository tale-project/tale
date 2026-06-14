'use node';

/**
 * The single way to enumerate + read a config domain's catalog JSON files for an
 * org, via the registry's Layer-B dir resolver. Replaces the bespoke
 * `readdir`/`readFileSafe` loops in the prompt + workflow default-provisioners
 * so catalog reads go through one code path (centralized skip rules for
 * `.history/`, dotfiles, and `*.secrets.json`).
 *
 * Lets a missing-directory error propagate so callers that self-retry while the
 * scaffold is still copying the catalog keep working (an empty dir returns `[]`,
 * which is distinct from "not yet created").
 */

import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { readFileSafe } from '../file_io';
import { resolveDomainDir } from './resolvers';

export interface CatalogFile {
  /** Path relative to the domain dir, POSIX separators (e.g. `general/hello.json`). */
  relativePath: string;
  /** Raw file content. */
  content: string;
}

export async function listCatalogArea(
  domain: string,
  orgSlug: string,
  opts: { recursive?: boolean } = {},
): Promise<CatalogFile[]> {
  const dir = resolveDomainDir(domain, orgSlug);
  // `readdir` throws ENOENT when the dir doesn't exist yet — intentionally
  // propagated so a provisioner racing the scaffold can catch + retry.
  const entries = await readdir(dir, {
    withFileTypes: true,
    recursive: opts.recursive ?? false,
  });

  const files: CatalogFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    if (entry.name.endsWith('.secrets.json')) continue;

    const parentPath = entry.parentPath ?? dir;
    const relativePath = path
      .relative(dir, path.join(parentPath, entry.name))
      .split(path.sep)
      .join('/');
    // Skip `.history/` and other dotfile dirs/files anywhere in the path.
    if (relativePath.split('/').some((seg) => seg.startsWith('.'))) continue;

    const content = await readFileSafe(path.join(parentPath, entry.name));
    if (content === null) continue;
    files.push({ relativePath, content });
  }
  return files;
}
