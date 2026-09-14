import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import navJson from '@/content/nav.json';
import {
  firstNavSlug,
  flattenNav,
  isNavGroup,
  navGroupTrail,
  UI_DOCS_NAV,
  type UiDocsNavEntry,
} from '@/lib/content/nav';
import deMessages from '@/messages/de.yml';
import enMessages from '@/messages/en.yml';
import frMessages from '@/messages/fr.yml';
import { CONTENT_ROOT, listAllContent } from '@/scripts/walk-content';

/**
 * The navigation contract from `content/README.md`: every nav entry resolves
 * to a real markdown file, every markdown file is reachable from the tree
 * exactly once, and every group label has a string in every locale the site
 * ships. Reads the real files — `nav.json`, `content/**`, `messages/*.yml` —
 * so a rename that only half-lands fails here rather than in a reader's
 * browser.
 */

interface RawNavGroup {
  label: string;
  pages: ReadonlyArray<string | RawNavGroup>;
}

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the nav config's shape is the contract `lib/content/nav.ts` parses
const RAW_NAV = navJson as unknown as { groups: readonly RawNavGroup[] };

/** Group labels in file order, outermost first — the authored source of truth. */
function rawGroupLabels(
  groups: readonly RawNavGroup[] = RAW_NAV.groups,
): string[] {
  return groups.flatMap((group) => [
    group.label,
    ...rawGroupLabels(
      group.pages.filter(
        (page): page is RawNavGroup => typeof page !== 'string',
      ),
    ),
  ]);
}

/** Page slugs in file order — what `flattenNav()` has to reproduce. */
function rawSlugs(pages: ReadonlyArray<string | RawNavGroup>): string[] {
  return pages.flatMap((page) =>
    typeof page === 'string' ? [page] : rawSlugs(page.pages),
  );
}

const RAW_SLUG_ORDER = RAW_NAV.groups.flatMap((group) => rawSlugs(group.pages));

/** Every group label key the resolved tree carries, in tree order. */
function resolvedGroupKeys(
  entries: readonly UiDocsNavEntry[] = UI_DOCS_NAV,
): string[] {
  return entries.flatMap((entry) =>
    isNavGroup(entry)
      ? [entry.labelKey, ...resolvedGroupKeys(entry.pages)]
      : [],
  );
}

const LOCALES = {
  en: enMessages,
  de: deMessages,
  fr: frMessages,
} as const;

function navGroupLabel(
  messages: Record<string, unknown>,
  label: string,
): unknown {
  const nav = messages.nav;
  if (typeof nav !== 'object' || nav === null) return undefined;
  const groups = (nav as { groups?: unknown }).groups;
  if (typeof groups !== 'object' || groups === null) return undefined;
  return (groups as Record<string, unknown>)[label];
}

describe('navigation tree', () => {
  it('declares at least one group', () => {
    expect(UI_DOCS_NAV.length).toBeGreaterThan(0);
  });

  it('every nav slug resolves to a markdown file under content/', () => {
    const missing = flattenNav()
      .map((entry) => entry.slug)
      .filter((slug) => !existsSync(resolve(CONTENT_ROOT, `${slug}.md`)));
    expect(missing, 'nav slugs with no content/<slug>.md').toEqual([]);
  });

  it('every content file appears in the nav exactly once', async () => {
    const records = await listAllContent();
    const counts = new Map<string, number>();
    for (const entry of flattenNav()) {
      counts.set(entry.slug, (counts.get(entry.slug) ?? 0) + 1);
    }

    const unreachable = records
      .map((record) => record.slug)
      .filter((slug) => !counts.has(slug));
    expect(unreachable, 'pages missing from content/nav.json').toEqual([]);

    const duplicated = [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([slug]) => slug);
    expect(duplicated, 'pages listed more than once in the nav').toEqual([]);
  });

  it.each(Object.keys(LOCALES))(
    'every group label has a nav.groups.<label> string in %s',
    (locale) => {
      const messages = LOCALES[locale as keyof typeof LOCALES];
      const missing = rawGroupLabels().filter(
        (label) => typeof navGroupLabel(messages, label) !== 'string',
      );
      expect(
        missing,
        `missing nav.groups.* keys in messages/${locale}.yml`,
      ).toEqual([]);
    },
  );

  it('prefixes every resolved group label with the nav namespace', () => {
    expect(resolvedGroupKeys()).toEqual(
      rawGroupLabels().map((label) => `nav.groups.${label}`),
    );
  });
});

describe('firstNavSlug', () => {
  it('is the introduction — where /docs sends a reader', () => {
    expect(firstNavSlug()).toBe('getting-started/introduction');
  });
});

describe('navGroupTrail', () => {
  it('names the group a known page sits in', () => {
    expect(navGroupTrail('components/button')).toEqual([
      'nav.groups.components',
    ]);
    expect(navGroupTrail('getting-started/introduction')).toEqual([
      'nav.groups.gettingStarted',
    ]);
  });

  it('is empty for a slug the nav does not carry', () => {
    expect(navGroupTrail('components/nope')).toEqual([]);
  });
});

describe('flattenNav', () => {
  it('reproduces nav.json order, depth-first', () => {
    expect(flattenNav().map((entry) => entry.slug)).toEqual(RAW_SLUG_ORDER);
  });

  it('drives prev/next, so it holds every page exactly once', () => {
    const slugs = flattenNav().map((entry) => entry.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
