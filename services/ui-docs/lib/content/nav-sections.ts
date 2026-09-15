/**
 * The design-system tree, resolved for the shared `@tale/ui/docs` frame:
 * every slug turned into its `/docs` route and every label translated, so the
 * rail, the drawer, the neighbour cards and the 404 suggestions render
 * without knowing how this site stores its content.
 */

import type {
  DocsNavEntry as FrameEntry,
  DocsNavGroup as FrameGroup,
  DocsNavPage as FramePage,
} from '@tale/ui/docs/docs-nav';

import { getDocPage } from '@/lib/content/loader';
import {
  flattenNav,
  isNavGroup,
  navGroupTrail,
  UI_DOCS_NAV,
  type UiDocsNavEntry,
  type UiDocsNavGroup,
} from '@/lib/content/nav';
import { docPath } from '@/lib/content/paths';

/** Translate a `nav.groups.*` label key; the caller's `t` is bound to `nav`. */
export type TranslateNavKey = (key: string) => string;

function groupLabel(group: UiDocsNavGroup, t: TranslateNavKey): string {
  return t(group.labelKey.replace(/^nav\./, ''));
}

/** A page as the frame names it: its title, else its slug. */
export function navPage(slug: string): FramePage {
  return {
    href: docPath(slug),
    label: getDocPage(slug)?.frontmatter.title ?? slug,
  };
}

function resolveEntry(entry: UiDocsNavEntry, t: TranslateNavKey): FrameEntry {
  if (isNavGroup(entry)) {
    return {
      label: groupLabel(entry, t),
      items: entry.pages.map((child) => resolveEntry(child, t)),
    };
  }
  return navPage(entry.slug);
}

/**
 * The navigation groups above a search result's page, translated. Index ids
 * are the page slugs. `undefined` for a page outside the tree, so the palette
 * falls back to the result's URL segments.
 */
export function searchResultTrail(
  resultId: string,
  t: TranslateNavKey,
): string[] | undefined {
  const groups = navGroupTrail(resultId);
  return groups.length > 0
    ? groups.map((key) => t(key.replace(/^nav\./, '')))
    : undefined;
}

/** Every top-level group of `content/nav.json`, as the rail's sections. */
export function navSections(t: TranslateNavKey): FrameGroup[] {
  return UI_DOCS_NAV.map((group) => ({
    label: groupLabel(group, t),
    items: group.pages.map((entry) => resolveEntry(entry, t)),
  }));
}

/** The pages before and after `slug` in navigation order. */
export function navNeighbours(slug: string): {
  prev: FramePage | null;
  next: FramePage | null;
} {
  const flat = flattenNav();
  const idx = flat.findIndex((entry) => entry.slug === slug);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0 ? navPage(flat[idx - 1].slug) : null,
    next: idx < flat.length - 1 ? navPage(flat[idx + 1].slug) : null,
  };
}
