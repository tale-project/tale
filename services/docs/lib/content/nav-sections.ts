/**
 * The docs tree, resolved for the shared `@tale/ui/docs` frame: every slug
 * turned into its locale's route and every label translated, so the rail,
 * the drawer, the neighbour cards and the 404 suggestions render without
 * knowing how this site stores its content.
 */

import type {
  DocsNavEntry as FrameEntry,
  DocsNavGroup as FrameGroup,
  DocsNavPage as FramePage,
} from '@tale/ui/docs/docs-nav';

import { getDocPage } from '@/lib/content/loader';
import {
  DOCS_NAV,
  type DocsNavEntry,
  type DocsNavGroup,
  flattenNav,
  isNavGroup,
  navGroupTrail,
} from '@/lib/content/nav';
import { docPath } from '@/lib/content/paths';
import type { SupportedLocale } from '@/lib/i18n/locales';

/** Translate a `nav.groups.*` label key; the caller's `t` is bound to `nav`. */
export type TranslateNavKey = (key: string) => string;

function groupLabel(group: DocsNavGroup, t: TranslateNavKey): string {
  return t(group.labelKey.replace(/^nav\./, ''));
}

function resolveEntry(
  entry: DocsNavEntry,
  locale: SupportedLocale,
  t: TranslateNavKey,
): FrameEntry {
  if (isNavGroup(entry)) {
    return {
      label: groupLabel(entry, t),
      items: entry.pages.map((child) => resolveEntry(child, locale, t)),
    };
  }
  const doc = getDocPage(locale, entry.slug);
  return {
    href: docPath(locale, entry.slug),
    label:
      entry.labels?.[locale] ??
      doc?.frontmatter.sidebarTitle ??
      doc?.frontmatter.title ??
      entry.slug,
  };
}

/**
 * The navigation groups above a search result's page, translated — including
 * groups without an index page. Index ids carry `locale:slug`, independent of
 * the deployment base URL. `undefined` for a page outside the tree, so the
 * palette falls back to the result's URL segments.
 */
export function searchResultTrail(
  resultId: string,
  t: TranslateNavKey,
): string[] | undefined {
  const slug = resultId.slice(resultId.indexOf(':') + 1);
  const groups = navGroupTrail(slug);
  return groups.length > 0
    ? groups.map((key) => t(key.replace(/^nav\./, '')))
    : undefined;
}

/** Every top-level group of `docs/nav.json`, as the rail's sections. */
export function navSections(
  locale: SupportedLocale,
  t: TranslateNavKey,
): FrameGroup[] {
  return DOCS_NAV.map((group) => ({
    label: groupLabel(group, t),
    items: group.pages.map((entry) => resolveEntry(entry, locale, t)),
  }));
}

/** Title-case the last slug segment (e.g. `self-hosted/install/quickstart` → `Quickstart`). */
function prettifySlug(slug: string): string {
  const segments = slug.split('/');
  const last = segments.findLast((segment) => segment.length > 0) ?? slug;
  return last
    .split('-')
    .map((part) =>
      part.length === 0 ? part : part[0].toUpperCase() + part.slice(1),
    )
    .join(' ');
}

function neighbour(locale: SupportedLocale, slug: string): FramePage {
  const title = getDocPage(locale, slug)?.frontmatter.title;
  return {
    href: docPath(locale, slug),
    label: title && title.length > 0 ? title : prettifySlug(slug),
  };
}

/** The pages before and after `slug` in navigation order. */
export function navNeighbours(
  locale: SupportedLocale,
  slug: string,
): { prev: FramePage | null; next: FramePage | null } {
  const flat = flattenNav();
  const idx = flat.findIndex((entry) => entry.slug === slug);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0 ? neighbour(locale, flat[idx - 1].slug) : null,
    next: idx < flat.length - 1 ? neighbour(locale, flat[idx + 1].slug) : null,
  };
}
