import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The public code-editor modules are light: a page that renders no code
 * field, or only imports a helper (`locate`, `template-scan`, `providers`),
 * never downloads CodeMirror. Only `code-editor-view.tsx`, loaded through a
 * dynamic `import()`, may reach it. This walks the static imports from each
 * public entry through the package's own files and refuses a CodeMirror or
 * Lezer module, or the view itself, anywhere in that closure.
 *
 * Only `import type` and `export type … from` are left out of the walk. The
 * package compiles with `verbatimModuleSyntax`, so an inline
 * `import { type X } from '…'` stays in the output as an import of that
 * module, and counts here.
 */

const HERE = __dirname;
const SRC = resolve(HERE, '..', '..', '..');

const ENTRIES = [
  'code-editor.tsx',
  'providers.ts',
  'template-scan.ts',
  'locate.ts',
].map((name) => join(HERE, name));

const HEAVY = /^(?:@codemirror\/|@lezer\/|codemirror$|style-mod$|w3c-keyname$)/;
const VIEW = join(HERE, 'code-editor-view.tsx');

/**
 * `import … from '…'`, `export … from '…'` and `import '…'` at the start of a
 * statement; a dynamic `import('…')` does not match. Group 1 is `type ` on a
 * type-only statement, group 2 the specifier.
 */
const STATIC_IMPORT =
  /(?:^|[;}\n])\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function resolveRelative(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null;
}

/** Every bare specifier and package file the entries load statically. */
function staticClosure(entries: readonly string[]): {
  files: Set<string>;
  packages: Map<string, string>;
} {
  const files = new Set<string>();
  const packages = new Map<string, string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || files.has(file)) continue;
    files.add(file);
    const source = withoutComments(readFileSync(file, 'utf8'));
    for (const match of source.matchAll(STATIC_IMPORT)) {
      if (match[1] !== undefined) continue;
      const specifier = match[2];
      if (specifier.startsWith('.')) {
        const target = resolveRelative(file, specifier);
        // A relative import of a non-script file (CSS, YAML) holds no code.
        if (target !== null) queue.push(target);
      } else if (!packages.has(specifier)) {
        packages.set(specifier, relative(SRC, file));
      }
    }
  }
  return { files, packages };
}

describe('the light code-editor modules', () => {
  const { files, packages } = staticClosure(ENTRIES);

  it('walks the entries and what they import', () => {
    // A walk that found nothing would pass every check below.
    expect(files.size).toBeGreaterThan(ENTRIES.length);
    expect(packages.has('react')).toBe(true);
  });

  it('would catch CodeMirror, as the view itself shows', () => {
    const view = staticClosure([VIEW]).packages;
    expect(view.has('@codemirror/view')).toBe(true);
    expect([...view.keys()].some((specifier) => HEAVY.test(specifier))).toBe(
      true,
    );
  });

  it('never load CodeMirror or Lezer statically', () => {
    const heavy = [...packages]
      .filter(([specifier]) => HEAVY.test(specifier))
      .map(([specifier, file]) => `${file} imports ${specifier}`);
    expect(heavy).toEqual([]);
  });

  it('reach the editor view only through a dynamic import', () => {
    expect(files.has(VIEW)).toBe(false);
    expect(readFileSync(join(HERE, 'code-editor.tsx'), 'utf8')).toContain(
      "import('./code-editor-view')",
    );
  });
});
