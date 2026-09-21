/**
 * Navigation tree for the design-system docs. The structure is read from
 * [`content/nav.json`](../../content/nav.json) at build time so an author can
 * reorder groups or pages without touching code. The shape is:
 *
 *   { groups: [{ label, pages: [slug | { label, pages }] }] }
 *
 * `label` resolves through the `nav.groups.*` namespace in `messages/*.yml`;
 * slugs match the on-disk layout under `content/`. `tests/navigation.test.ts`
 * checks that every entry resolves to a real markdown file and that every
 * file appears exactly once in the tree.
 */

import navJson from '../../content/nav.json';

export interface UiDocsNavPage {
  slug: string;
}

export interface UiDocsNavGroup {
  /** Key under the `nav.groups` namespace, e.g. `nav.groups.components`. */
  labelKey: string;
  pages: readonly UiDocsNavEntry[];
}

export type UiDocsNavEntry = UiDocsNavPage | UiDocsNavGroup;

export function isNavGroup(entry: UiDocsNavEntry): entry is UiDocsNavGroup {
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

function resolveEntry(entry: string | RawNavGroup): UiDocsNavEntry {
  if (isRawGroup(entry)) return resolveGroup(entry);
  return { slug: entry };
}

function resolveGroup(group: RawNavGroup): UiDocsNavGroup {
  return {
    labelKey: `nav.groups.${group.label}`,
    pages: group.pages.map(resolveEntry),
  };
}

const RAW: RawNavConfig = navJson as unknown as RawNavConfig;

export const UI_DOCS_NAV: readonly UiDocsNavGroup[] =
  RAW.groups.map(resolveGroup);

/** The first page in nav order — where `/docs` sends a reader. */
export function firstNavSlug(): string {
  const first = flattenNav()[0];
  return first ? first.slug : 'getting-started/introduction';
}

/** Group label keys leading to a slug, outermost first. */
export function navGroupTrail(slug: string): readonly string[] {
  const find = (
    entries: readonly UiDocsNavEntry[],
    labels: readonly string[],
  ): readonly string[] | null => {
    for (const entry of entries) {
      if (isNavGroup(entry)) {
        const found = find(entry.pages, [...labels, entry.labelKey]);
        if (found) return found;
      } else if (entry.slug === slug) {
        return labels;
      }
    }
    return null;
  };
  return find(UI_DOCS_NAV, []) ?? [];
}

/**
 * Pages inside one top-level group, nested subgroups included. The front
 * page's section cards state how much a section holds, so the figure comes
 * from the same tree the rail renders and cannot drift from it.
 */
export function navGroupPageCount(label: string): number {
  const group = UI_DOCS_NAV.find((g) => g.labelKey === `nav.groups.${label}`);
  if (!group) return 0;
  const count = (entries: readonly UiDocsNavEntry[]): number =>
    entries.reduce(
      (total, entry) => total + (isNavGroup(entry) ? count(entry.pages) : 1),
      0,
    );
  return count(group.pages);
}

/** Flatten every page in nav order — drives prev/next and the sitemap. */
export function flattenNav(): { slug: string }[] {
  const out: { slug: string }[] = [];
  const walk = (entries: readonly UiDocsNavEntry[]) => {
    for (const entry of entries) {
      if (isNavGroup(entry)) walk(entry.pages);
      else out.push({ slug: entry.slug });
    }
  };
  for (const group of UI_DOCS_NAV) walk(group.pages);
  return out;
}
