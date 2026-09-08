/**
 * The only module that touches disk: walk a checkout, find every
 * `tests/manual/` tree, and build the model the rules read.
 *
 * Discovery is by path shape rather than by a list, so a repo never has to
 * register a new service's manual layer anywhere — scaffolding one is enough.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import type { Doc, ManualRoot, Repo, Suite } from './model';
import { parseSuite } from './parse';

/**
 * Directories a walk never descends into. Dot-directories are skipped too (see
 * `walk`), which is most of the cost in a large checkout — a repo's `.git`
 * alone outweighs its source.
 */
const SKIP = new Set([
  'node_modules',
  'dist',
  'dist-ssr',
  'coverage',
  'build',
  'out',
  'target',
  'test-results',
  'playwright-report',
  'storybook-static',
  '_generated',
  // Generator templates hold a manual tree in .hbs form; it is scaffolded, not
  // run, and the repo excludes the directory from tsconfig and oxlint too.
  'templates',
]);

/** The directory whose presence marks a manual root. */
const MARKER = path.join('tests', 'manual');

function names(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

/** Subdirectory names, from one directory read — no stat per entry. */
function directories(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function read(root: string, relative: string): Doc | undefined {
  try {
    return {
      name: path.basename(relative),
      path: relative,
      text: readFileSync(path.join(root, relative), 'utf8'),
    };
  } catch {
    return undefined;
  }
}

/** Every `tests/manual` directory under `root`, repo-relative and sorted. */
export function findManualRoots(root: string): string[] {
  const found: string[] = [];
  const walk = (relative: string): void => {
    for (const name of directories(path.join(root, relative))) {
      if (SKIP.has(name) || name.startsWith('.')) continue;
      const next = relative ? path.join(relative, name) : name;
      if (next.endsWith(MARKER)) {
        found.push(next);
        continue;
      }
      walk(next);
    }
  };
  walk('');
  return found.sort();
}

function collectSuites(root: string, manual: string): Suite[] {
  const dir = path.join(manual, 'suites');
  return names(path.join(root, dir))
    .filter((name) => name.endsWith('.md'))
    .map((name) => {
      const relative = path.join(dir, name);
      const doc = read(root, relative);
      return parseSuite(name, relative, doc?.text ?? '');
    });
}

function collectRoot(root: string, manual: string): ManualRoot {
  const referenceEntries = names(path.join(root, manual, 'reference'));
  return {
    path: manual,
    entries: names(path.join(root, manual)),
    readme: read(root, path.join(manual, 'readme.md')),
    suites: collectSuites(root, manual),
    referenceEntries,
    reference: referenceEntries
      .filter((name) => name.endsWith('.md'))
      .flatMap((name) => {
        const doc = read(root, path.join(manual, 'reference', name));
        return doc ? [doc] : [];
      }),
    runEntries: names(path.join(root, manual, 'runs')),
    journal: read(root, path.join(manual, 'runs', 'readme.md')),
  };
}

export function collect(root: string): Repo {
  return { roots: findManualRoots(root).map((m) => collectRoot(root, m)) };
}
