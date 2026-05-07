import { cn } from '@tale/ui/cn';
import { Link, useRouterState } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

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

const easeOut = [0.22, 1, 0.36, 1] as const;

function stripPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function collectGroupSlugs(group: DocsNavGroup): string[] {
  const out: string[] = [];
  const walk = (entries: readonly DocsNavEntry[]) => {
    for (const entry of entries) {
      if (isNavGroup(entry)) walk(entry.pages);
      else out.push(entry.slug);
    }
  };
  walk(group.pages);
  return out;
}

function groupContainsActive(
  group: DocsNavGroup,
  activeSlug: string,
  pathname: string,
  locale: SupportedLocale,
): boolean {
  for (const slug of collectGroupSlugs(group)) {
    if (slug === activeSlug) return true;
    if (pathname === docPath(locale, slug)) return true;
  }
  return false;
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

  // Indent scales with nesting depth so deep pages stay aligned with their
  // group label. Each depth level adds 12px to the left padding.
  const paddingLeft = 12 + depth * 12;

  return (
    <li>
      <Link
        to={href}
        ref={isActive ? activeRef : undefined}
        aria-current={isActive ? 'page' : undefined}
        onClick={onNavigate}
        style={{ paddingLeft }}
        className={cn(
          'focus-visible:ring-fg-base/40 group relative block rounded-md py-1.5 pr-2 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none',
          isActive
            ? 'bg-bg-elevated text-fg-base font-medium'
            : 'text-fg-muted hover:text-fg-base hover:bg-bg-elevated/60',
        )}
      >
        {depth > 0 ? (
          <span
            aria-hidden
            className={cn(
              'absolute top-0 bottom-0 w-px transition-colors',
              isActive
                ? 'bg-fg-base'
                : 'bg-border-base group-hover:bg-fg-muted',
            )}
            style={{ left: paddingLeft - 12 }}
          />
        ) : null}
        {label}
      </Link>
    </li>
  );
}

function NavSubGroup({
  group,
  locale,
  activeSlug,
  pathname,
  depth,
  activeRef,
  onNavigate,
}: {
  group: DocsNavGroup;
  locale: SupportedLocale;
  activeSlug: string;
  pathname: string;
  depth: number;
  activeRef?: React.RefObject<HTMLAnchorElement | null>;
  onNavigate?: () => void;
}) {
  const { t } = useT('nav');
  const reduceMotion = useReducedMotion();
  const containsActive = groupContainsActive(
    group,
    activeSlug,
    pathname,
    locale,
  );
  const [open, setOpen] = useState(containsActive);

  // Auto-expand when the active page moves into this branch.
  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);

  const paddingLeft = 12 + depth * 12;

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        style={{ paddingLeft }}
        className={cn(
          'focus-visible:ring-fg-base/40 group relative flex w-full items-center justify-between rounded-md py-1.5 pr-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none',
          containsActive
            ? 'text-fg-base'
            : 'text-fg-muted hover:text-fg-base hover:bg-bg-elevated/40',
        )}
      >
        {depth > 0 ? (
          <span
            aria-hidden
            className="bg-border-base absolute top-0 bottom-0 w-px"
            style={{ left: paddingLeft - 12 }}
          />
        ) : null}
        <span>{t(stripPrefix(group.labelKey, 'nav.'))}</span>
        <motion.span
          aria-hidden
          animate={{ rotate: open ? 90 : 0 }}
          transition={
            reduceMotion ? { duration: 0 } : { duration: 0.2, ease: easeOut }
          }
          className="text-fg-subtle group-hover:text-fg-muted ml-2 inline-flex shrink-0"
        >
          <ChevronRight className="size-3.5" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="branch"
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={
              reduceMotion
                ? { height: 'auto', opacity: 1 }
                : { height: 0, opacity: 0 }
            }
            transition={
              reduceMotion ? { duration: 0 } : { duration: 0.22, ease: easeOut }
            }
            className="overflow-hidden"
          >
            <NavBranch
              entries={group.pages}
              locale={locale}
              activeSlug={activeSlug}
              pathname={pathname}
              depth={depth + 1}
              activeRef={activeRef}
              onNavigate={onNavigate}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
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
  return (
    <ul className="flex flex-col">
      {entries.map((entry, i) => {
        if (isNavGroup(entry)) {
          return (
            <NavSubGroup
              key={`${entry.labelKey}-${i}`}
              group={entry}
              locale={locale}
              activeSlug={activeSlug}
              pathname={pathname}
              depth={depth}
              activeRef={activeRef}
              onNavigate={onNavigate}
            />
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
      <h2 className="text-fg-base mb-2 px-2 text-[11px] font-semibold tracking-[0.08em] uppercase">
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
 * the desktop `DocsSidebar` and the mobile drawer carried by `DocsHeader`.
 * Sub-groups expand/collapse on click and auto-expand when the active page
 * lives inside their subtree.
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

  // Memoize the rendered tree so the sticky sidebar doesn't churn on every
  // route change unrelated to its data dependencies.
  const tree = useMemo(
    () => (
      <DocsNavList
        locale={locale}
        activeSlug={activeSlug}
        activeRef={activeRef}
      />
    ),
    [locale, activeSlug],
  );

  return (
    <nav
      aria-label="Documentation"
      className="border-border-base sticky top-16 hidden h-[calc(100vh-4rem)] shrink-0 overflow-y-auto border-r pr-4 pl-2 lg:block lg:w-64"
    >
      {tree}
    </nav>
  );
}
