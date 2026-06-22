import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  EMBEDDED_EXAMPLES,
  EMBEDDED_REFERENCE,
} from '../../generated/embedded-files';

export async function fetchReference(projectDir: string): Promise<void> {
  const referenceDir = join(projectDir, '.tale', 'reference');

  if (existsSync(referenceDir)) {
    await rm(referenceDir, { recursive: true });
  }
  await mkdir(referenceDir, { recursive: true });

  for (const [relPath, content] of Object.entries(EMBEDDED_REFERENCE)) {
    const destPath = join(referenceDir, relPath);
    await mkdir(dirname(destPath), { recursive: true });
    await writeFile(destPath, content);
  }
}

/**
 * Read a slice of the embedded `builtin-configs/<prefix>/...` catalog as a
 * map of `<rest>` → content. The built-in catalog is generic — its children
 * ARE the domains, with no org level — and every org's runtime config is
 * seeded from it under the org-first layout (`<root>/<orgSlug>/<domain>/`).
 */
export function getEmbeddedExamples(prefix: string): Map<string, string> {
  const result = new Map<string, string>();
  const builtinPrefix = `builtin-configs/${prefix}/`;

  for (const [path, content] of Object.entries(EMBEDDED_EXAMPLES)) {
    if (path.startsWith(builtinPrefix)) {
      const relPath = path.slice(builtinPrefix.length);
      result.set(relPath, content);
    }
  }

  return result;
}
