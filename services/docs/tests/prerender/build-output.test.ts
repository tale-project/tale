import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const DIST_SSR = join(ROOT, 'dist-ssr');

/** Every file under `dir`, relative to it. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)));
}

describe('docs build output', () => {
  // The client build ships `public/` in `dist/`; the SSR bundle only renders
  // the pages the prerender writes there. A second copy in `dist-ssr/` (the
  // tutorial videos, every screenshot and its variants) doubled the build's
  // cached output past the 512 MiB a worker may write to one file
  // (`vite.config.ts`, `environments.ssr.build.copyPublicDir`).
  it('keeps public/ out of the SSR bundle', () => {
    expect(existsSync(join(DIST_SSR, 'entry-server.js'))).toBe(true);
    const copied = filesUnder(PUBLIC).filter((file) =>
      existsSync(join(DIST_SSR, file)),
    );
    expect(copied).toEqual([]);
  });
});
