import fs from 'node:fs';
import path from 'node:path';

import { extractImageRefs, parseFrontmatter } from './markdown';
import { CONTENT_ROOT } from './paths';
import { walkDocs } from './walk';

/**
 * Every `/images/...` target a docs page in any locale references, as a
 * `public/`-relative path (`images/<section>/<shot>.webp`). The manifest
 * sweep and the variant generator (`scripts/optimize-images.ts`) share it,
 * so "a page shows this image" means the same thing to both.
 */
export function pageImageTargets(): Set<string> {
  const out = new Set<string>();
  for (const rel of walkDocs()) {
    const raw = fs
      .readFileSync(path.join(CONTENT_ROOT, rel), 'utf8')
      .replaceAll('\r\n', '\n');
    const { body } = parseFrontmatter(raw);
    for (const ref of extractImageRefs(body)) {
      if (ref.target.startsWith('/images/')) out.add(ref.target.slice(1));
    }
  }
  return out;
}
