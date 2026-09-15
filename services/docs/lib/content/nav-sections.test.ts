import { readFileSync } from 'node:fs';

import { isDocsNavGroup } from '@tale/ui/docs/docs-nav';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { navNeighbours, navSections, searchResultTrail } from './nav-sections';

/** A `nav`-bound translator over one locale's catalog, as `useT('nav')` is. */
function navTranslator(locale: 'en' | 'de' | 'fr') {
  const catalog = parseYaml(
    readFileSync(
      new URL(`../../messages/${locale}.yml`, import.meta.url),
      'utf8',
    ),
  ) as { nav: Record<string, unknown> };
  return (key: string): string => {
    let node: unknown = catalog.nav;
    for (const part of key.split('.')) {
      node = (node as Record<string, unknown> | undefined)?.[part];
    }
    if (typeof node !== 'string') throw new Error(`missing nav.${key}`);
    return node;
  };
}

describe('navSections', () => {
  it('turns every nav.json group into a translated rail section', () => {
    const sections = navSections('de', navTranslator('de'));
    expect(sections[0]?.label).toBe('Start');
    expect(sections.map((section) => section.label)).toContain(
      'Selbst gehostet',
    );
  });

  it('links rows to their locale route, section roots without `/index`', () => {
    const sections = navSections('fr', navTranslator('fr'));
    const hrefs: string[] = [];
    const walk = (entries: (typeof sections)[number]['items']) => {
      for (const entry of entries) {
        if (isDocsNavGroup(entry)) walk(entry.items);
        else hrefs.push(entry.href);
      }
    };
    for (const section of sections) walk(section.items);
    expect(hrefs).toContain('/fr');
    expect(hrefs).toContain('/fr/platform');
    expect(hrefs).toContain('/fr/self-hosted/install/quickstart');
    expect(hrefs.some((href) => href.endsWith('/index'))).toBe(false);
  });
});

describe('navNeighbours', () => {
  it('names both neighbours of a page in nav order', () => {
    const { prev, next } = navNeighbours(
      'en',
      'self-hosted/install/quickstart',
    );
    expect(prev?.href).toMatch(/^\//);
    expect(next?.href).toMatch(/^\/self-hosted\//);
    expect(prev?.label).toBeTruthy();
    expect(next?.label).toBeTruthy();
  });

  it('has no neighbours for a page outside the tree', () => {
    expect(navNeighbours('en', 'unknown/page')).toEqual({
      prev: null,
      next: null,
    });
  });
});

describe('searchResultTrail', () => {
  it.each([
    ['de', 'Projekte'],
    ['fr', 'Projets'],
  ] as const)('localizes nested search ancestors in %s', (locale, projects) => {
    const trail = searchResultTrail(
      `${locale}:platform/projects/tasks`,
      navTranslator(locale),
    );
    expect(trail).toContain(projects);
    expect(trail).not.toContain('Projects');
  });

  it('leaves a page outside the tree to the URL fallback', () => {
    expect(
      searchResultTrail('en:unknown/page', navTranslator('en')),
    ).toBeUndefined();
  });
});
