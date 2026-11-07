/**
 * Every installed package that `src/` imports must be declared in this
 * package's own manifest. Inside the monorepo a missing entry is masked by
 * hoisting; for a consumer that installs `@tale/ui` from GitHub it is a
 * runtime crash. Runtime modules need a `dependencies` / `peerDependencies`
 * entry; tests, stories and the test tooling shipped under `src/i18n/tests`
 * and `src/testing` may use `devDependencies` too.
 *
 * Only specifiers that resolve to a package under the workspace's
 * `node_modules` are checked — that is exactly the hoisting-masked case. A
 * specifier that resolves to nothing (a Vite virtual module, a code sample in
 * a story) is the type checker's business, not this guard's.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const PKG_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const NODE_MODULES = path.resolve(PKG_DIR, '../../node_modules');

interface Manifest {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const IMPORT_RE =
  /(?:^|[\s;(])(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*|@import\s+)['"]([^'"\n]+)['"]/gm;
const NODE_BUILTIN = /^(node:|bun:|bun$)/;
const DEV_SCOPE_DIRS = [
  `${path.sep}tests${path.sep}`,
  `${path.sep}testing${path.sep}`,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function packageName(specifier: string): string {
  return specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
}

function isInstalled(name: string): boolean {
  return fs.existsSync(path.join(NODE_MODULES, name, 'package.json'));
}

describe('package manifest', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8'),
  ) as Manifest;
  const runtimeDeclared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
  const devDeclared = new Set([
    ...runtimeDeclared,
    ...Object.keys(manifest.devDependencies ?? {}),
  ]);

  const missing = new Set<string>();
  for (const file of walk(path.join(PKG_DIR, 'src'))) {
    const text = fs.readFileSync(file, 'utf8');
    const devScope =
      /\.(test|stories|browser\.test)\.tsx?$/.test(file) ||
      DEV_SCOPE_DIRS.some((dir) => file.includes(dir));
    for (const match of text.matchAll(IMPORT_RE)) {
      const specifier = match[1];
      if (
        specifier.startsWith('.') ||
        specifier.startsWith('/') ||
        specifier.startsWith('@/') ||
        specifier === manifest.name ||
        specifier.startsWith(`${manifest.name}/`) ||
        NODE_BUILTIN.test(specifier) ||
        /\s/.test(specifier)
      ) {
        continue;
      }
      const name = packageName(specifier);
      if (!isInstalled(name)) continue;
      const declared = devScope ? devDeclared : runtimeDeclared;
      if (!declared.has(name)) {
        missing.add(`${path.relative(PKG_DIR, file)} → ${name}`);
      }
    }
  }

  it('declares every installed package its source imports', () => {
    expect([...missing].sort()).toEqual([]);
  });
});
