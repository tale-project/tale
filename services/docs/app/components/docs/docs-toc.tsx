import { cn } from '@tale/ui/cn';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import type { TocEntry } from '@tale/ui/markdown/extract-toc';
import {
  SUB_PANEL_ROW_CLASS,
  SubPanelSectionHeader,
  useSubPanelRowTreatment,
} from '@tale/ui/sub-panel-list';
import { useMediaQuery } from '@tale/ui/use-media-query';
import { useEffect, useState } from 'react';

import { useT } from '@/lib/i18n/client';

interface DocsTocProps {
  entries: TocEntry[];
}

// Distance from the top of the viewport at which a heading is considered
// "passed" and becomes the active TOC entry. Sits just below the headings'
// `scroll-margin-top` (`scroll-mt-24` = 96px) so that anchor navigation —
// which parks the target heading exactly at the scroll-margin line — also
// marks it active. Adjacent headings on the page are spaced much further
// than the 24px gap, so the extra tolerance can't cause oscillation.
const ACTIVATION_OFFSET = 120;

/** Tailwind `xl` — the width at which the outline earns its own rail. */
const TOC_RAIL_QUERY = '(min-width: 1280px)';

/**
 * Scroll-spy over the page's headings. The active heading is the last one
 * whose top has scrolled past {@link ACTIVATION_OFFSET}. The rule is
 * monotonic in scroll direction, so adjacent headings can't oscillate the
 * way an IntersectionObserver does when its callback only delivers entries
 * that just crossed a threshold (which makes `visible[0]` flip between two
 * close-together headings).
 */
function useActiveHeading(entries: TocEntry[]): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (entries.length === 0) return undefined;

    let rafId: number | null = null;
    let lastActive: string | null = null;

    const computeActive = () => {
      rafId = null;
      const scrolledToBottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 2;
      let next: string | null = null;
      if (scrolledToBottom) {
        next = entries[entries.length - 1]?.id ?? null;
      } else {
        for (const entry of entries) {
          const el = document.getElementById(entry.id);
          if (!el) continue;
          const top = el.getBoundingClientRect().top;
          if (top - ACTIVATION_OFFSET <= 0) next = entry.id;
          else break;
        }
        if (next === null) next = entries[0]?.id ?? null;
      }
      if (next !== lastActive) {
        lastActive = next;
        setActiveId(next);
      }
    };

    const schedule = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(computeActive);
    };

    computeActive();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [entries]);

  return activeId;
}

function TocRow({
  entry,
  active,
  onSelect,
}: {
  entry: TocEntry;
  active: boolean;
  onSelect: (e: React.MouseEvent<HTMLAnchorElement>, id: string) => void;
}) {
  const treatment = useSubPanelRowTreatment(active);
  return (
    <li>
      <a
        href={`#${entry.id}`}
        onClick={(e) => onSelect(e, entry.id)}
        aria-current={active ? 'true' : undefined}
        className={cn(
          SUB_PANEL_ROW_CLASS,
          'h-auto min-h-8 py-1.5 leading-snug',
          entry.level === 3 && 'pl-5',
          treatment.className,
        )}
        {...(treatment.style !== undefined ? { style: treatment.style } : {})}
      >
        {entry.text}
      </a>
    </li>
  );
}

function TocList({ entries }: DocsTocProps) {
  const activeId = useActiveHeading(entries);

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (history.replaceState) history.replaceState(null, '', `#${id}`);
  };

  return (
    <ul className="flex flex-col gap-0.5">
      {entries.map((entry) => (
        <TocRow
          key={entry.id}
          entry={entry}
          active={activeId === entry.id}
          onSelect={handleClick}
        />
      ))}
    </ul>
  );
}

/**
 * Right-rail "On this page" outline with scroll-spy, in the sub-panel row
 * vocabulary so it reads as the mirror of the navigation rail. Renders from
 * `xl` up; narrower viewports get {@link DocsTocOutline} above the article.
 */
export function DocsToc({ entries }: DocsTocProps) {
  const { t } = useT('docs');
  const isRail = useMediaQuery(TOC_RAIL_QUERY);
  if (entries.length === 0) return null;

  return (
    <aside
      aria-label={t('onThisPage')}
      // The outline ships twice (rail + disclosure) so the prerendered HTML
      // carries it at any width; mark the copy the stylesheet hides so only
      // one reaches the accessibility tree — the `AdaptiveHeader` contract.
      aria-hidden={!isRail || undefined}
      className="sticky top-13 hidden h-[calc(100vh-3.25rem)] w-56 shrink-0 flex-col gap-1 overflow-y-auto py-8 pr-4 xl:flex"
    >
      <SubPanelSectionHeader label={t('onThisPage')} />
      <TocList entries={entries} />
    </aside>
  );
}

/**
 * The same outline for viewports with no room for the rail: a disclosure
 * above the article body, collapsed by default so the page still opens on
 * its own first paragraph.
 */
export function DocsTocOutline({ entries }: DocsTocProps) {
  const { t } = useT('docs');
  const isRail = useMediaQuery(TOC_RAIL_QUERY);
  if (entries.length === 0) return null;

  return (
    <nav
      aria-label={t('onThisPage')}
      aria-hidden={isRail || undefined}
      className="border-border mb-8 border-b pb-4 xl:hidden"
    >
      <CollapsibleDetails summary={t('onThisPage')}>
        <div className="mt-2">
          <TocList entries={entries} />
        </div>
      </CollapsibleDetails>
    </nav>
  );
}
