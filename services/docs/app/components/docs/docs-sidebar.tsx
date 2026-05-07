import { cn } from '@tale/ui/cn';
import { Link, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';

import { getDocPage } from '@/lib/content/loader';
import {
  type DocsNavEntry,
  type DocsNavGroup,
  type DocsNavPage,
  DOCS_NAV,
  isNavGroup,
} from '@/lib/content/nav';
import { docPath } from '@/lib/content/paths';
import { useT } from '@/lib/i18n/client';
import type { SupportedLocale } from '@/lib/i18n/locales';

interface DocsSidebarProps {
  locale: SupportedLocale;
  /** Slug of the active page; used for highlighting. */
  activeSlug: string;
}

interface DocsNavListProps {
  locale: SupportedLocale;
  activeSlug: string;
  /**
   * Optional ref attached to the active link so callers can scroll it into
   * view on mount.
   */
  activeRef?: React.RefObject<HTMLAnchorElement | null>;
  /**
   * Optional callback fired when any nav link is clicked. Used by the mobile
   * drawer to close itself on navigation.
   */
  onNavigate?: () => void;
}

function stripPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function PageLink({
  page,
  locale,
  activeSlug,
  pathname,
  depth,
  activeRef,
  onNavigate,
}: {
  page: DocsNavPage;
  locale: SupportedLocale;
  activeSlug: string;
  pathname: string;
  depth: number;
  activeRef?: React.RefObject<HTMLAnchorElement | null>;
  onNavigate?: () => void;
}) {
  const doc = getDocPage(locale, page.slug);
  const label =
    page.labels?.[locale] ??
    doc?.frontmatter.sidebarTitle ??
    doc?.frontmatter.title ??
    page.slug;
  const href = docPath(locale, page.slug);
  const isActive = pathname === href || activeSlug === page.slug;

  return (
    <li>
      <Link
        to={href}
        ref={isActive ? activeRef : undefined}
        aria-current={isActive ? 'page' : undefined}
        onClick={onNavigate}
        className={cn(
          'focus-visible:ring-fg-base/40 block rounded-md py-1 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none',
          // Pad-start scales with nesting depth so deep pages stay aligned
          // with their group label.
          depth === 0 ? 'px-2' : depth === 1 ? 'px-2 pl-4' : 'px-2 pl-6',
          isActive
            ? 'bg-bg-elevated text-fg-base font-medium'
            : 'text-fg-muted hover:text-fg-base hover:bg-bg-elevated/50',
        )}
      >
        {label}
      </Link>
    </li>
  );
}

function NavBranch({
  entries,
  locale,
  activeSlug,
  pathname,
  depth,
  activeRef,
  onNavigate,
}: {
  entries: readonly DocsNavEntry[];
  locale: SupportedLocale;
  activeSlug: string;
  pathname: string;
  depth: number;
  activeRef?: React.RefObject<HTMLAnchorElement | null>;
  onNavigate?: () => void;
}) {
  const { t } = useT('nav');
  return (
    <ul className="flex flex-col">
      {entries.map((entry, i) => {
        if (isNavGroup(entry)) {
          return (
            <li
              key={`${entry.labelKey}-${i}`}
              className={depth === 0 ? 'mt-2 first:mt-0' : 'mt-2'}
            >
              <h3
                className={cn(
                  'text-fg-base mb-1 px-2 text-xs font-semibold tracking-wide uppercase',
                  // Sub-group labels at depth ≥ 1 indent so they align with
                  // sibling page labels.
                  depth === 1 && 'pl-4',
                  depth >= 2 && 'pl-6',
                )}
              >
                {t(stripPrefix(entry.labelKey, 'nav.'))}
              </h3>
              <NavBranch
                entries={entry.pages}
                locale={locale}
                activeSlug={activeSlug}
                pathname={pathname}
                depth={depth + 1}
                activeRef={activeRef}
                onNavigate={onNavigate}
              />
            </li>
          );
        }
        return (
          <PageLink
            key={`${entry.slug}-${i}`}
            page={entry}
            locale={locale}
            activeSlug={activeSlug}
            pathname={pathname}
            depth={depth}
            activeRef={activeRef}
            onNavigate={onNavigate}
          />
        );
      })}
    </ul>
  );
}

function NavGroup({
  group,
  locale,
  activeSlug,
  pathname,
  activeRef,
  onNavigate,
}: {
  group: DocsNavGroup;
  locale: SupportedLocale;
  activeSlug: string;
  pathname: string;
  activeRef?: React.RefObject<HTMLAnchorElement | null>;
  onNavigate?: () => void;
}) {
  const { t } = useT('nav');
  return (
    <li className="mb-6 last:mb-0">
      <h2 className="text-fg-base mb-2 px-2 text-xs font-semibold tracking-wide uppercase">
        {t(stripPrefix(group.labelKey, 'nav.'))}
      </h2>
      <NavBranch
        entries={group.pages}
        locale={locale}
        activeSlug={activeSlug}
        pathname={pathname}
        depth={0}
        activeRef={activeRef}
        onNavigate={onNavigate}
      />
    </li>
  );
}

/**
 * Renders the docs navigation tree as an unstyled `<ul>`. Used both inside
 * the desktop `DocsSidebar` and the mobile `DocsMobileNav` drawer.
 */
export function DocsNavList({
  locale,
  activeSlug,
  activeRef,
  onNavigate,
}: DocsNavListProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <ul className="py-6">
      {DOCS_NAV.map((group, i) => (
        <NavGroup
          key={`${group.labelKey}-${i}`}
          group={group}
          locale={locale}
          activeSlug={activeSlug}
          pathname={pathname}
          activeRef={activeRef}
          onNavigate={onNavigate}
        />
      ))}
    </ul>
  );
}

export function DocsSidebar({ locale, activeSlug }: DocsSidebarProps) {
  const activeRef = useRef<HTMLAnchorElement | null>(null);

  // Scroll the active item into view on mount so deep pages aren't hidden
  // below the fold when the sidebar first renders. `block: 'nearest'` avoids
  // jumping when it's already visible.
  useEffect(() => {
    const el = activeRef.current;
    if (!el) return;
    el.scrollIntoView({ block: 'nearest' });
    // We only want this on initial mount, not on every pathname change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <nav
      aria-label="Documentation"
      className="border-border-base sticky top-16 hidden h-[calc(100vh-4rem)] shrink-0 overflow-y-auto border-r pr-6 pl-4 lg:block lg:w-64"
    >
      <DocsNavList
        locale={locale}
        activeSlug={activeSlug}
        activeRef={activeRef}
      />
    </nav>
  );
}
