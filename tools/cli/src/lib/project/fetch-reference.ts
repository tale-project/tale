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

export function getEmbeddedExamples(prefix: string): Map<string, string> {
  const result = new Map<string, string>();
  const examplesPrefix = `examples/${prefix}/`;

  for (const [path, content] of Object.entries(EMBEDDED_EXAMPLES)) {
    if (path.startsWith(examplesPrefix)) {
      const relPath = path.slice(examplesPrefix.length);
      result.set(relPath, content);
    }
  }

  return result;
}
