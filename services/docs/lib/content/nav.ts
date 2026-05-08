/**
 * Navigation tree for the documentation site. The structure is read from
 * [`/docs/nav.json`](../../../../docs/nav.json) at build time so authors
 * can reorder groups or pages without touching code. The shape is:
 *
 *   { groups: [{ label, pages: [slug | { label, pages }] }] }
 *
 * `label` resolves through the `nav.groups.*` namespace in the docs
 * message bundles; slugs match the on-disk layout under `/docs/<locale>/`.
 * The navigation-parity test (`tests/navigation-parity.test.ts`) checks
 * that every entry resolves to a real markdown file in every base locale.
 */

import type { SupportedLocale } from '@/lib/i18n/locales';

import navJson from '../../../../docs/nav.json';

export interface DocsNavPage {
  slug: string;
  /** Per-locale label override; falls back to the page frontmatter title. */
  labels?: Partial<Record<SupportedLocale, string>>;
}

export type DocsNavEntry = DocsNavPage | DocsNavGroup;

export interface DocsNavGroup {
  /** Key under the `nav.groups` namespace, e.g. `nav.groups.install`. */
  labelKey: string;
  pages: readonly DocsNavEntry[];
}

export function isNavGroup(entry: DocsNavEntry): entry is DocsNavGroup {
  return 'labelKey' in entry;
}

interface RawNavGroup {
  label: string;
  pages: ReadonlyArray<string | RawNavGroup>;
}

interface RawNavConfig {
  groups: readonly RawNavGroup[];
}

function isRawGroup(entry: string | RawNavGroup): entry is RawNavGroup {
  return typeof entry !== 'string';
}

function resolveEntry(entry: string | RawNavGroup): DocsNavEntry {
  if (isRawGroup(entry)) return resolveGroup(entry);
  return { slug: entry };
}

function resolveGroup(group: RawNavGroup): DocsNavGroup {
  return {
    labelKey: `nav.groups.${group.label}`,
    pages: group.pages.map(resolveEntry),
  };
}

const RAW: RawNavConfig = navJson as unknown as RawNavConfig;

export const DOCS_NAV: readonly DocsNavGroup[] = RAW.groups.map(resolveGroup);

/** Flatten every page in nav order — used for prev/next + sitemap iteration. */
export function flattenNav(): { slug: string }[] {
  const out: { slug: string }[] = [];
  const walk = (entries: readonly DocsNavEntry[]) => {
    for (const entry of entries) {
      if (isNavGroup(entry)) {
        walk(entry.pages);
      } else {
        out.push({ slug: entry.slug });
      }
    }
  };
  for (const group of DOCS_NAV) {
    walk(group.pages);
  }
  return out;
}

/**
 * Resolve the slug that comes before `slug` in the flattened nav order.
 *
 * Returns `null` if `slug` is the first page in the nav, or if `slug`
 * is not present in the nav at all (e.g. an orphan markdown file).
 */
export function getPrevSlug(slug: string): string | null {
  const flat = flattenNav();
  const idx = flat.findIndex((p) => p.slug === slug);
  if (idx <= 0) return null;
  return flat[idx - 1]?.slug ?? null;
}

/**
 * Resolve the slug that comes after `slug` in the flattened nav order.
 *
 * Returns `null` if `slug` is the last page in the nav, or if `slug`
 * is not present in the nav at all (e.g. an orphan markdown file).
 */
export function getNextSlug(slug: string): string | null {
  const flat = flattenNav();
  const idx = flat.findIndex((p) => p.slug === slug);
  if (idx === -1 || idx >= flat.length - 1) return null;
  return flat[idx + 1]?.slug ?? null;
}
