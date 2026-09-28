import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Guardrail: every settings list pages and creates the same way.
 *
 * - Its page size is `DEFAULT_LIST_PAGE_SIZE` from `@tale/ui/use-list-page`,
 *   never a number of its own — Members once showed ten rows while Teams
 *   showed twenty. A deliberate exception names its reason in the code and is
 *   listed in `PAGE_SIZE_EXCEPTIONS` below.
 * - Its create button is `DataTable`'s `addAction`, never the `actionMenu`
 *   escape hatch — so it has the standard size and placement and, on a list
 *   without a search box, moves into the empty state instead of doubling up
 *   with a second create button there.
 *
 * A pure source walk (no DOM), like `governance/components/skeleton-conventions.test.ts`.
 */
const SETTINGS_DIR = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(SETTINGS_DIR, '..', '..');

/** The skills catalog is a settings page that lives with its feature. */
const EXTRA_SOURCES = [
  join(APP_DIR, 'features/skills/components/skills-settings.tsx'),
];

/**
 * Path prefix (relative to the app) → why its page size is not the shared one.
 * An entry is a whole feature so the exception's reasoning lives in one place
 * however the feature spreads its number across files.
 */
const PAGE_SIZE_EXCEPTIONS: Record<string, string> = {
  'features/settings/audit-logs/':
    'the audit and error logs page a server trail on a full page of their own — see `LOG_PAGE_SIZE`',
};

const isException = (name: string) =>
  Object.keys(PAGE_SIZE_EXCEPTIONS).some((prefix) => name.startsWith(prefix));

const PAGE_SIZE_LITERALS = [
  // `pageSize: 10`, `initialNumItems = 25`
  /\b(?:pageSize|initialNumItems)\s*[:=]\s*\d/,
  // `args.initialNumItems ?? 25`
  /\b(?:pageSize|initialNumItems)\s*\?\?\s*\d/,
  // `loadMore(25)`
  /\bloadMore\(\s*\d/,
  // `const PAGE_SIZE = 25`, `const LOG_PAGE_SIZE = 30`
  /\b[A-Z_]*PAGE_SIZE\s*=\s*\d/,
];

const setsOwnPageSize = (src: string) =>
  PAGE_SIZE_LITERALS.some((pattern) => pattern.test(src));

function listSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listSources(path);
    const isSource =
      /\.tsx?$/.test(entry.name) &&
      !/\.(?:test|browser\.test|stories)\.tsx?$/.test(entry.name);
    return isSource ? [path] : [];
  });
}

const sources = [
  ...listSources(SETTINGS_DIR),
  ...listSources(join(APP_DIR, 'routes/dashboard/$id/settings')),
  ...EXTRA_SOURCES,
].map((path) => ({
  name: relative(APP_DIR, path),
  src: readFileSync(path, 'utf8'),
}));

describe('settings list conventions', () => {
  it('finds the settings sources', () => {
    expect(sources.length).toBeGreaterThan(100);
    expect(sources.map((s) => s.name)).toContain(
      'features/settings/organization/components/member-table.tsx',
    );
  });

  it('pages every list by the shared list page size', () => {
    const offenders = sources
      .filter(({ name, src }) => !isException(name) && setsOwnPageSize(src))
      .map(({ name }) => name);
    expect(
      offenders,
      'These set their own page size. Use DEFAULT_LIST_PAGE_SIZE from @tale/ui/use-list-page, or name the exception and add it to PAGE_SIZE_EXCEPTIONS with its reason.',
    ).toEqual([]);
  });

  it('keeps every listed exception live', () => {
    const stale = Object.keys(PAGE_SIZE_EXCEPTIONS).filter(
      (prefix) =>
        !sources.some(
          ({ name, src }) => name.startsWith(prefix) && setsOwnPageSize(src),
        ),
    );
    expect(
      stale,
      'These no longer set their own page size (or are gone) — drop them from PAGE_SIZE_EXCEPTIONS.',
    ).toEqual([]);
  });

  it('creates through addAction, never the actionMenu slot', () => {
    const offenders = sources
      .filter(({ src }) => /\bactionMenu=\{/.test(src))
      .map(({ name }) => name);
    expect(
      offenders,
      "These put a create button in DataTable's actionMenu slot. Pass addAction={{ label, icon, onClick }} instead.",
    ).toEqual([]);
  });
});
