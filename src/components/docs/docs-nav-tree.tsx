'use client';

import { cn } from '@tale/ui/cn';
import { Stack } from '@tale/ui/layout';
import {
  SUB_PANEL_ROW_CLASS,
  SubPanelDisclosureBody,
  SubPanelSectionHeader,
  useSubPanelRowTreatment,
} from '@tale/ui/sub-panel-list';
import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { type RefObject, useEffect, useState } from 'react';

import {
  type DocsNavEntry,
  type DocsNavGroup,
  type DocsNavPage,
  docsNavGroupContains,
  isDocsNavGroup,
} from './docs-nav';

export interface DocsNavTreeProps {
  /** Top-level groups, rendered as the rail's sections. */
  sections: readonly DocsNavGroup[];
  /** Route of the page on screen; drives the row treatment. */
  activeHref: string;
  /**
   * Optional ref attached to the active row so a caller can scroll it into
   * view on mount (the rail does; the drawer re-mounts on every open).
   */
  activeRef?: RefObject<HTMLLIElement | null>;
  /** Fired when a page row is chosen — the drawer closes itself with it. */
  onNavigate?: () => void;
}

interface BranchContext {
  activeHref: string;
  activeRef?: RefObject<HTMLLIElement | null>;
  onNavigate?: () => void;
}

/** Left padding per nesting level, on top of the row's own `px-2`. */
const DEPTH_CLASS = ['', 'pl-5', 'pl-8', 'pl-11'] as const;

function depthClass(depth: number): string {
  return DEPTH_CLASS[Math.min(depth, DEPTH_CLASS.length - 1)];
}

/**
 * A page row in the shared sub-panel row vocabulary. Composed from
 * `SUB_PANEL_ROW_CLASS` + `useSubPanelRowTreatment` rather than
 * `SubPanelRowLink` because the drawer needs an `onClick` and the rail needs
 * a ref on the active row — the composition the package documents for rows
 * that carry more than a path.
 */
function NavRow({
  page,
  depth,
  context,
}: {
  page: DocsNavPage;
  depth: number;
  context: BranchContext;
}) {
  const isActive = page.href === context.activeHref;
  const treatment = useSubPanelRowTreatment(isActive);

  return (
    <li ref={isActive ? context.activeRef : undefined}>
      <Link
        to={page.href}
        // The router marks a link active by PREFIX unless told otherwise, and
        // an active link gets `aria-current="page"` for free — so on a deep
        // page every ancestor row would claim to be the current page. The
        // trail row is the only current one.
        activeOptions={{ exact: true }}
        aria-current={isActive ? 'page' : undefined}
        onClick={context.onNavigate}
        className={cn(
          SUB_PANEL_ROW_CLASS,
          'h-auto min-h-8 py-1.5 leading-snug',
          depthClass(depth),
          treatment.className,
        )}
        {...(treatment.style !== undefined ? { style: treatment.style } : {})}
      >
        {page.label}
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
  depth,
  context,
}: {
  group: DocsNavGroup;
  depth: number;
  context: BranchContext;
}) {
  const containsActive = docsNavGroupContains(group, context.activeHref);
  const [open, setOpen] = useState(containsActive);

  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);

  const treatment = useSubPanelRowTreatment(containsActive && !open);

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
        <span className="min-w-0 truncate">{group.label}</span>
        <ChevronRight
          aria-hidden
          className={cn(
            'text-muted-foreground ml-2 size-3.5 shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
      </button>
      <SubPanelDisclosureBody open={open}>
        <NavBranch entries={group.items} depth={depth + 1} context={context} />
      </SubPanelDisclosureBody>
    </li>
  );
}

function NavBranch({
  entries,
  depth,
  context,
}: {
  entries: readonly DocsNavEntry[];
  depth: number;
  context: BranchContext;
}) {
  return (
    <ul className="flex flex-col gap-0.5">
      {entries.map((entry, i) =>
        isDocsNavGroup(entry) ? (
          <NavDisclosure
            key={`${entry.label}-${i}`}
            group={entry}
            depth={depth}
            context={context}
          />
        ) : (
          <NavRow
            key={`${entry.href}-${i}`}
            page={entry}
            depth={depth}
            context={context}
          />
        ),
      )}
    </ul>
  );
}

/**
 * The documentation tree in the sub-panel list vocabulary: one
 * `SubPanelSectionHeader` per top-level group, rows and disclosures below it.
 * Rendered by the desktop rail and by the phone drawer, so both speak the
 * same row language.
 */
export function DocsNavTree({
  sections,
  activeHref,
  activeRef,
  onNavigate,
}: DocsNavTreeProps) {
  const context: BranchContext = { activeHref, activeRef, onNavigate };

  return (
    <Stack gap={6}>
      {sections.map((section, i) => (
        <Stack key={`${section.label}-${i}`} gap={1}>
          <SubPanelSectionHeader label={section.label} />
          <NavBranch entries={section.items} depth={0} context={context} />
        </Stack>
      ))}
    </Stack>
  );
}
