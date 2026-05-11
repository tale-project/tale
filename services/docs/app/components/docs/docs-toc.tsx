import { cn } from '@tale/ui/cn';
import type { TocEntry } from '@tale/ui/markdown/extract-toc';
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

/**
 * Right-rail "On this page" outline with scroll-spy. The active heading is
 * the last one whose top has scrolled past `ACTIVATION_OFFSET`. The rule is
 * monotonic in scroll direction, so adjacent headings can't oscillate the
 * way an IntersectionObserver does when its callback only delivers entries
 * that just crossed a threshold (which makes `visible[0]` flip between two
 * close-together headings).
 */
export function DocsToc({ entries }: DocsTocProps) {
  const { t } = useT('docs');
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

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveId(id);
    if (history.replaceState) history.replaceState(null, '', `#${id}`);
  };

  if (entries.length === 0) return null;

  return (
    <aside
      aria-label={t('onThisPage')}
      className="sticky top-16 hidden h-[calc(100vh-4rem)] w-56 shrink-0 overflow-y-auto py-6 pl-4 xl:block"
    >
      <h2 className="text-fg-base mb-2 px-2 text-[11px] font-semibold tracking-[0.08em] uppercase">
        {t('onThisPage')}
      </h2>
      <ul className="flex flex-col">
        {entries.map((entry) => {
          const isActive = activeId === entry.id;
          const depth = entry.level === 3 ? 1 : 0;
          const paddingLeft = 12 + depth * 12;
          return (
            <li key={entry.id}>
              <a
                href={`#${entry.id}`}
                onClick={(e) => handleClick(e, entry.id)}
                aria-current={isActive ? 'true' : undefined}
                style={{ paddingLeft }}
                className={cn(
                  'focus-visible:ring-fg-base/40 group relative block rounded-md py-1.5 pr-2 text-sm leading-tight transition-colors focus-visible:ring-2 focus-visible:outline-none',
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
                {entry.text}
              </a>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
