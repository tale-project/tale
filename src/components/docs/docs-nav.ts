/**
 * The navigation model every docs chrome piece renders from. A site resolves
 * its own tree — labels translated, slugs turned into routes — and hands the
 * result to the layout, so the rail, the phone drawer and the not-found
 * suggestions never need to know how that site stores its content.
 */

/** One page row. */
export interface DocsNavPage {
  /** The page's route. Also its identity: the active row is the one whose
   *  `href` equals the layout's `activeHref`. */
  href: string;
  label: string;
}

/**
 * A group of rows. At the top level a group is a rail section (an uppercase
 * label over its rows); nested inside another group it is a disclosure.
 */
export interface DocsNavGroup {
  label: string;
  items: readonly DocsNavEntry[];
}

export type DocsNavEntry = DocsNavPage | DocsNavGroup;

/** A crumb in the header trail. The last crumb is the current page. */
export interface DocsCrumb {
  label: string;
  /** Route to link to. Omitted for an ancestor with no page of its own. */
  href?: string;
}

export function isDocsNavGroup(entry: DocsNavEntry): entry is DocsNavGroup {
  return 'items' in entry;
}

/** Whether any page below `group`, at any depth, is the page on screen. */
export function docsNavGroupContains(
  group: DocsNavGroup,
  activeHref: string,
): boolean {
  return group.items.some((entry) =>
    isDocsNavGroup(entry)
      ? docsNavGroupContains(entry, activeHref)
      : entry.href === activeHref,
  );
}
