import { cn } from '@tale/ui/cn';
import { Stack } from '@tale/ui/layout';
import {
  SUB_PANEL_ROW_CLASS,
  SubPanelDisclosureBody,
  SubPanelSectionHeader,
  useSubPanelRowTreatment,
} from '@tale/ui/sub-panel-list';
import { Link, useRouterState } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';

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

export interface DocsNavTreeProps {
  locale: SupportedLocale;
  /** Slug of the active page; used for highlighting. */
  activeSlug: string;
  /**
   * Optional ref attached to the active row so callers can scroll it into
   * view on mount (the rail does; the drawer re-mounts on every open).
   */
  activeRef?: React.RefObject<HTMLLIElement | null>;
  /** Fired when any page row is chosen — the drawer closes itself with it. */
  onNavigate?: () => void;
}

/** Left padding per nesting level, on top of the row's own `px-2`. */
const DEPTH_CLASS = ['', 'pl-5', 'pl-8', 'pl-11'] as const;

function depthClass(depth: number): string {
  return DEPTH_CLASS[Math.min(depth, DEPTH_CLASS.length - 1)];
}

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

/**
 * A page row in the shared sub-panel row vocabulary. Composed from
 * `SUB_PANEL_ROW_CLASS` + `useSubPanelRowTreatment` rather than
 * `SubPanelRowLink` because the drawer needs an `onClick` and the rail needs
 * a ref on the active row — the package documents this composition for rows
 * that carry more than a path.
 */
function NavRow({
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
  activeRef?: React.RefObject<HTMLLIElement | null>;
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
  const treatment = useSubPanelRowTreatment(isActive);

  return (
    <li ref={isActive ? activeRef : undefined}>
      <Link
        to={href}
        // The router marks a link active by PREFIX unless told otherwise, and
        // an active link gets `aria-current="page"` for free — so on a deep
        // page every ancestor row would claim to be the current page. The
        // trail row is the only current one.
        activeOptions={{ exact: true }}
        aria-current={isActive ? 'page' : undefined}
        onClick={onNavigate}
        className={cn(
          SUB_PANEL_ROW_CLASS,
          'h-auto min-h-8 py-1.5 leading-snug',
          depthClass(depth),
          treatment.className,
        )}
        {...(treatment.style !== undefined ? { style: treatment.style } : {})}
      >
        {label}
      </Link>
    </li>
  );
}

/**
 * A nested group: a disclosure row that opens its children inline. Opens
 * itself when the route moves into the branch and never forces itself shut —
 * the reader owns the disclosure from then on (the settings rail's contract).
 */
function NavDisclosure({
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
  activeRef?: React.RefObject<HTMLLIElement | null>;
  onNavigate?: () => void;
}) {
  const { t } = useT('nav');
  const containsActive = groupContainsActive(
    group,
    activeSlug,
    pathname,
    locale,
  );
  const [open, setOpen] = useState(containsActive);

  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);

  const parentActive = containsActive && !open;
  const treatment = useSubPanelRowTreatment(parentActive);

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          SUB_PANEL_ROW_CLASS,
          'w-full justify-between text-left',
          depthClass(depth),
          treatment.className,
        )}
        {...(treatment.style !== undefined ? { style: treatment.style } : {})}
      >
        <span className="min-w-0 truncate">
          {t(stripPrefix(group.labelKey, 'nav.'))}
        </span>
        <ChevronRight
          aria-hidden
          className={cn(
            'text-muted-foreground ml-2 size-3.5 shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
      </button>
      <SubPanelDisclosureBody open={open}>
        <NavBranch
          entries={group.pages}
          locale={locale}
          activeSlug={activeSlug}
          pathname={pathname}
          depth={depth + 1}
          activeRef={activeRef}
          onNavigate={onNavigate}
        />
      </SubPanelDisclosureBody>
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
  activeRef?: React.RefObject<HTMLLIElement | null>;
  onNavigate?: () => void;
}) {
  return (
    <ul className="flex flex-col gap-0.5">
      {entries.map((entry, i) =>
        isNavGroup(entry) ? (
          <NavDisclosure
            key={`${entry.labelKey}-${i}`}
            group={entry}
            locale={locale}
            activeSlug={activeSlug}
            pathname={pathname}
            depth={depth}
            activeRef={activeRef}
            onNavigate={onNavigate}
          />
        ) : (
          <NavRow
            key={`${entry.slug}-${i}`}
            page={entry}
            locale={locale}
            activeSlug={activeSlug}
            pathname={pathname}
            depth={depth}
            activeRef={activeRef}
            onNavigate={onNavigate}
          />
        ),
      )}
    </ul>
  );
}

/**
 * The documentation tree in the sub-panel list vocabulary: one
 * `SubPanelSectionHeader` per top-level group from `docs/nav.json`, rows and
 * disclosures below it. Rendered by the desktop rail and by the mobile
 * drawer, so both speak the same row language.
 */
export function DocsNavTree({
  locale,
  activeSlug,
  activeRef,
  onNavigate,
}: DocsNavTreeProps) {
  const { t } = useT('nav');
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <Stack gap={6}>
      {DOCS_NAV.map((group, i) => (
        <Stack key={`${group.labelKey}-${i}`} gap={1}>
          <SubPanelSectionHeader
            label={t(stripPrefix(group.labelKey, 'nav.'))}
          />
          <NavBranch
            entries={group.pages}
            locale={locale}
            activeSlug={activeSlug}
            pathname={pathname}
            depth={0}
            activeRef={activeRef}
            onNavigate={onNavigate}
          />
        </Stack>
      ))}
    </Stack>
  );
}
