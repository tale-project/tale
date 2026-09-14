import { cn } from '@tale/ui/cn';
import { Stack } from '@tale/ui/layout';
import {
  SUB_PANEL_ROW_CLASS,
  SubPanelSectionHeader,
  useSubPanelRowTreatment,
} from '@tale/ui/sub-panel-list';
import { Link } from '@tanstack/react-router';

import { getDocPage } from '@/lib/content/loader';
import {
  isNavGroup,
  UI_DOCS_NAV,
  type UiDocsNavEntry,
  type UiDocsNavGroup,
  type UiDocsNavPage,
} from '@/lib/content/nav';
import { docPath } from '@/lib/content/paths';
import { useT } from '@/lib/i18n/client';

export interface DocsNavTreeProps {
  /** Slug of the active page; drives the row treatment. */
  activeSlug: string;
  /**
   * Optional ref attached to the active row so a caller can scroll it into
   * view on mount (the rail does; the drawer re-mounts on every open).
   */
  activeRef?: React.RefObject<HTMLLIElement | null>;
  /** Fired when a page row is chosen — the drawer closes itself with it. */
  onNavigate?: () => void;
}

/** Left padding per nesting level, on top of the row's own `px-2`. */
const DEPTH_CLASS = ['', 'pl-5', 'pl-8'] as const;

function depthClass(depth: number): string {
  return DEPTH_CLASS[Math.min(depth, DEPTH_CLASS.length - 1)];
}

function stripPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
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
  activeSlug,
  depth,
  activeRef,
  onNavigate,
}: {
  page: UiDocsNavPage;
  activeSlug: string;
  depth: number;
  activeRef?: React.RefObject<HTMLLIElement | null>;
  onNavigate?: () => void;
}) {
  const doc = getDocPage(page.slug);
  const label = doc?.frontmatter.title ?? page.slug;
  const isActive = activeSlug === page.slug;
  const treatment = useSubPanelRowTreatment(isActive);

  return (
    <li ref={isActive ? activeRef : undefined}>
      <Link
        to={docPath(page.slug)}
        // The router marks a link active by PREFIX unless told otherwise, and
        // an active link gets `aria-current="page"` for free — so on a deep
        // page every ancestor row would claim to be the current page.
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

function NavBranch({
  entries,
  activeSlug,
  depth,
  activeRef,
  onNavigate,
}: {
  entries: readonly UiDocsNavEntry[];
  activeSlug: string;
  depth: number;
  activeRef?: React.RefObject<HTMLLIElement | null>;
  onNavigate?: () => void;
}) {
  return (
    <ul className="flex flex-col gap-0.5">
      {entries.map((entry, i) =>
        isNavGroup(entry) ? (
          <NestedGroup
            key={`${entry.labelKey}-${i}`}
            group={entry}
            activeSlug={activeSlug}
            depth={depth}
            activeRef={activeRef}
            onNavigate={onNavigate}
          />
        ) : (
          <NavRow
            key={`${entry.slug}-${i}`}
            page={entry}
            activeSlug={activeSlug}
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
 * A group nested below a top-level section. The design-system tree is two
 * levels deep by design, so a nested group renders as a plain sub-label with
 * its rows indented — no disclosure to collapse, and nothing to hide.
 */
function NestedGroup({
  group,
  activeSlug,
  depth,
  activeRef,
  onNavigate,
}: {
  group: UiDocsNavGroup;
  activeSlug: string;
  depth: number;
  activeRef?: React.RefObject<HTMLLIElement | null>;
  onNavigate?: () => void;
}) {
  const { t } = useT('nav');
  return (
    <li>
      <SubPanelSectionHeader label={t(stripPrefix(group.labelKey, 'nav.'))} />
      <NavBranch
        entries={group.pages}
        activeSlug={activeSlug}
        depth={depth + 1}
        activeRef={activeRef}
        onNavigate={onNavigate}
      />
    </li>
  );
}

/**
 * The documentation tree in the sub-panel list vocabulary: one
 * `SubPanelSectionHeader` per top-level group from `content/nav.json`, rows
 * below it. Rendered by the desktop rail and by the mobile drawer, so both
 * speak the same row language.
 */
export function DocsNavTree({
  activeSlug,
  activeRef,
  onNavigate,
}: DocsNavTreeProps) {
  const { t } = useT('nav');

  return (
    <Stack gap={6}>
      {UI_DOCS_NAV.map((group, i) => (
        <Stack key={`${group.labelKey}-${i}`} gap={1}>
          <SubPanelSectionHeader
            label={t(stripPrefix(group.labelKey, 'nav.'))}
          />
          <NavBranch
            entries={group.pages}
            activeSlug={activeSlug}
            depth={0}
            activeRef={activeRef}
            onNavigate={onNavigate}
          />
        </Stack>
      ))}
    </Stack>
  );
}
