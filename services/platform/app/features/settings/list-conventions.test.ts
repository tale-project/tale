import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Guardrail: every settings list pages and creates the same way.
 *
 * - Its page size is `DEFAULT_LIST_PAGE_SIZE` from `@tale/ui/use-list-page`,
 *   never a number of its own — Members once showed ten rows while Teams
 *   showed twenty. A deliberate exception names its reason in the code and is
 *   listed in `PAGE_SIZE_EXCEPTIONS` below. A server read's `limit: <n>` is
 *   a number of its own as well; one that caps a whole read rather than
 *   sizing a page (the latest fifty events, every live counter) is listed in
 *   `FETCH_CAPS` with its reason. Leaving the size to a server default is a
 *   number this walk cannot see: pass the shared size to the request (the
 *   Trash's `limit` is held by its test).
 * - Its create button is `DataTable`'s `addAction`, never the `actionMenu`
 *   escape hatch — so it has the standard size and placement and, on a list
 *   without a search box, moves into the empty state instead of doubling up
 *   with a second create button there. The ban is on the slot, since no walk
 *   can tell what a button in it does; a list that one day needs it for
 *   something other than creating names that exception here, like the sizes.
 *
 * A settings list is anything a settings route renders: all of
 * `features/settings/` and the route folder, plus the pages that live with
 * their own feature (Skills, the Metrics pages) — found by following the
 * routes' imports, so the next such page is covered without a list to extend.
 *
 * A pure source walk (no DOM), like `governance/components/skeleton-conventions.test.ts`.
 */
const SETTINGS_DIR = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(SETTINGS_DIR, '..', '..');
const SETTINGS_ROUTES_DIR = join(APP_DIR, 'routes/dashboard/$id/settings');

/**
 * File (relative to the app) → why its page size is not the shared one. The
 * exception's number lives in that one file and every other file imports it,
 * so a second literal anywhere else in the feature is still flagged.
 */
const PAGE_SIZE_EXCEPTIONS: Record<string, string> = {
  'features/settings/audit-logs/logs-page-size.ts':
    'the audit and error logs are read by scrolling back through an unbounded trail — see `LOGS_PAGE_SIZE`',
};

/**
 * File (relative to the app) → why its read passes a literal `limit`: a cap
 * on a read that is never paged, not a page size.
 */
const FETCH_CAPS: Record<string, string> = {
  'features/settings/audit-logs/components/block-counters-table.tsx':
    'the live lockout counters are read whole, capped at 200 rows (the server clamps to 500)',
  'features/settings/governance/components/guardrails-overview.tsx':
    'Recent events is a feed of the latest 50 guardrail hits with no pages to turn, not a paged list',
};

const PAGE_SIZE_LITERALS = [
  // `pageSize: 10`, `initialNumItems = 25`
  /\b(?:pageSize|initialNumItems)\s*[:=]\s*\d/,
  // `pageSize={10}`
  /\b(?:pageSize|initialNumItems)=\{\s*\d/,
  // `args.initialNumItems ?? 25`
  /\b(?:pageSize|initialNumItems)\s*\?\?\s*\d/,
  // `loadMore(25)`
  /\bloadMore\(\s*\d/,
  // `const PAGE_SIZE = 25`, `export const LOGS_PAGE_SIZE = 30`
  /\b[A-Z_]*PAGE_SIZE\s*=\s*\d/,
];

// `{ organizationId, limit: 50 }`
const LIMIT_LITERAL = /\blimit\s*:\s*\d/;

const setsOwnPageSize = (src: string) =>
  PAGE_SIZE_LITERALS.some((pattern) => pattern.test(src));
const capsItsRead = (src: string) => LIMIT_LITERAL.test(src);

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

/** The app file an `@/app/…` or relative specifier names, if it is one. */
function resolveImport(from: string, specifier: string): string | undefined {
  const base = specifier.startsWith('@/app/')
    ? join(APP_DIR, specifier.slice('@/app/'.length))
    : specifier.startsWith('.')
      ? resolve(dirname(from), specifier)
      : undefined;
  if (base === undefined) return undefined;
  return [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ].find((path) => existsSync(path));
}

const importsOf = (path: string) =>
  [
    ...readFileSync(path, 'utf8').matchAll(
      /(?:\bfrom\s+|\bimport\(\s*)'([^']+)'/g,
    ),
  ].flatMap(([, specifier]) => resolveImport(path, specifier ?? '') ?? []);

/** `features/analytics` for any file under `app/features/analytics/`. */
const featureOf = (path: string) =>
  relative(APP_DIR, path).split('/').slice(0, 2).join('/');

/**
 * The settings pages that live with their own feature: every module a
 * settings route imports from outside `features/settings/`, and what those
 * import from the same feature. Staying inside the feature keeps shared
 * building blocks (a markdown table, a chat component) out of the walk.
 */
function featurePageSources(routeSources: string[]): string[] {
  const seen = new Set<string>();
  const queue = routeSources.flatMap(importsOf).filter((path) => {
    const name = relative(APP_DIR, path);
    return (
      name.startsWith('features/') && !name.startsWith('features/settings/')
    );
  });
  for (let path = queue.pop(); path !== undefined; path = queue.pop()) {
    if (seen.has(path)) continue;
    seen.add(path);
    const feature = featureOf(path);
    queue.push(...importsOf(path).filter((dep) => featureOf(dep) === feature));
  }
  return [...seen];
}

const routeSources = listSources(SETTINGS_ROUTES_DIR);
const sources = [
  ...listSources(SETTINGS_DIR),
  ...routeSources,
  ...featurePageSources(routeSources),
].map((path) => ({
  name: relative(APP_DIR, path),
  src: readFileSync(path, 'utf8'),
}));

describe('settings list conventions', () => {
  it('finds the settings sources', () => {
    expect(sources.length).toBeGreaterThan(100);
    expect(sources.map((s) => s.name)).toEqual(
      expect.arrayContaining([
        'features/settings/organization/components/member-table.tsx',
        // Settings pages that live with their feature, through the routes.
        'features/skills/components/skills-settings.tsx',
        'features/analytics/feedback/feedback-metrics-page.tsx',
        'features/analytics/feedback/recent-feedback-table.tsx',
      ]),
    );
    // Shared building blocks a settings page merely uses are not settings lists.
    expect(
      sources.filter(({ name }) => name.startsWith('features/shared/')),
    ).toEqual([]);
  });

  it('recognizes the ways a list writes a number of its own', () => {
    for (const own of [
      'pageSize: 10',
      'initialNumItems = 25',
      'pageSize={10}',
      'args.initialNumItems ?? 25',
      'recent.loadMore(25)',
      'const PAGE_SIZE = 25',
    ]) {
      expect(setsOwnPageSize(own), own).toBe(true);
    }
    expect(capsItsRead('{ organizationId, limit: 50 }')).toBe(true);
    for (const shared of [
      'pageSize: DEFAULT_LIST_PAGE_SIZE',
      'pageSize={pageSize}',
      'recent.loadMore(DEFAULT_LIST_PAGE_SIZE)',
      'limit: DEFAULT_LIST_PAGE_SIZE',
    ]) {
      expect(setsOwnPageSize(shared) || capsItsRead(shared), shared).toBe(
        false,
      );
    }
  });

  it('pages every list by the shared list page size', () => {
    const offenders = sources
      .filter(
        ({ name, src }) =>
          !(name in PAGE_SIZE_EXCEPTIONS) && setsOwnPageSize(src),
      )
      .map(({ name }) => name);
    expect(
      offenders,
      'These set their own page size. Use DEFAULT_LIST_PAGE_SIZE from @tale/ui/use-list-page, or name the exception and add it to PAGE_SIZE_EXCEPTIONS with its reason.',
    ).toEqual([]);
  });

  it('sizes every server read by the shared list page size', () => {
    const offenders = sources
      .filter(({ name, src }) => !(name in FETCH_CAPS) && capsItsRead(src))
      .map(({ name }) => name);
    expect(
      offenders,
      'These pass a literal limit to a read. Pass DEFAULT_LIST_PAGE_SIZE for a page, or add a read that is capped rather than paged to FETCH_CAPS with its reason.',
    ).toEqual([]);
  });

  it('keeps every listed exception live', () => {
    const stale = (
      listed: Record<string, string>,
      sets: (src: string) => boolean,
    ) =>
      Object.keys(listed).filter(
        (file) => !sources.some(({ name, src }) => name === file && sets(src)),
      );
    expect(
      [
        ...stale(PAGE_SIZE_EXCEPTIONS, setsOwnPageSize),
        ...stale(FETCH_CAPS, capsItsRead),
      ],
      'These no longer set their own size (or are gone) — drop them from PAGE_SIZE_EXCEPTIONS or FETCH_CAPS.',
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
