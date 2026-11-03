// The page, the server and the code they share stay apart. The image is built
// from slices of the tree: the page is built from `app/` and `lib/` (the
// `Dockerfile`'s builder stage copies nothing else), the server runs from
// `backend/` and `lib/`. An `import` across that line works in a test and in
// the dev server, and breaks the build of the one side that lacks the file, or
// ships server code in the page. Tests may cross it on purpose: a contract
// test drives the page's client against the real backend.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');

/** Where a side may not reach: the sides it must not import from. */
const FORBIDDEN: Readonly<Record<string, readonly string[]>> = {
  app: ['backend', 'tests'],
  backend: ['app', 'tests'],
  lib: ['app', 'backend', 'tests'],
};

/** Not shipped: tests, and the fakes the tests share. */
function isTestSupport(path: string): boolean {
  return (
    /\.(test|spec)\.tsx?$/.test(path) || path.startsWith('backend/testing/')
  );
}

function sourcesOf(side: string): string[] {
  const found: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.gen.ts')) {
        found.push(relative(ROOT, path));
      }
    }
  };
  visit(join(ROOT, side));
  return found.filter((path) => !isTestSupport(path));
}

const IMPORT = /\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

/** The side of the tree an import reaches, or undefined for a package. */
function reachedBy(file: string, specifier: string): string | undefined {
  let target: string;
  if (specifier.startsWith('@/')) target = specifier.slice(2);
  else if (specifier.startsWith('.')) {
    target = relative(ROOT, resolve(ROOT, dirname(file), specifier));
  } else return undefined;
  return target.split('/')[0];
}

describe('the sides of the tree', () => {
  for (const [side, forbidden] of Object.entries(FORBIDDEN)) {
    it(`${side}/ does not import from ${forbidden.map((name) => `${name}/`).join(' or ')}`, () => {
      const crossings: string[] = [];
      for (const file of sourcesOf(side)) {
        const text = readFileSync(join(ROOT, file), 'utf8');
        for (const [, specifier = ''] of text.matchAll(IMPORT)) {
          const reached = reachedBy(file, specifier);
          if (reached !== undefined && forbidden.includes(reached)) {
            crossings.push(`${file} imports ${specifier}`);
          }
        }
      }
      expect(crossings).toEqual([]);
    });
  }

  it('finds the sources it guards', () => {
    expect(sourcesOf('app').length).toBeGreaterThan(100);
    expect(sourcesOf('backend').length).toBeGreaterThan(30);
    expect(sourcesOf('lib').length).toBeGreaterThan(3);
  });
});
