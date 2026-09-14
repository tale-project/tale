import { cn } from '@tale/ui/cn';
import type { TocEntry } from '@tale/ui/markdown/extract-toc';
import { useEffect, useState } from 'react';

import { useT } from '@/lib/i18n/client';

interface DocsTocProps {
  entries: TocEntry[];
}

// Distance from the top of the viewport at which a heading counts as
// "passed" and becomes the active entry. Sits just below the headings'
// `scroll-margin-top` so anchor navigation — which parks the target exactly
// at the scroll-margin line — also marks it active.
const ACTIVATION_OFFSET = 120;

/**
 * The right rail: "On this page", with scroll-spy. The active heading is the
 * last one whose top has scrolled past `ACTIVATION_OFFSET`. That rule is
 * monotonic in scroll direction, so two adjacent headings cannot oscillate
 * the way an IntersectionObserver does when its callback only delivers the
 * entries that just crossed a threshold.
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
      className="sticky top-13 hidden h-[calc(100vh-3.25rem)] w-56 shrink-0 overflow-y-auto py-8 pl-4 xl:block"
    >
      <p className="text-muted-foreground mb-2 px-2 text-[11px] font-semibold tracking-wider uppercase">
        {t('onThisPage')}
      </p>
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
                  'focus-visible:ring-ring group relative block rounded-md py-1.5 pr-2 text-[13px] leading-tight transition-colors focus-visible:ring-2 focus-visible:outline-none',
                  isActive
                    ? 'bg-muted text-foreground font-medium'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                {depth > 0 ? (
                  <span
                    aria-hidden
                    className={cn(
                      'absolute top-0 bottom-0 w-px transition-colors',
                      isActive
                        ? 'bg-foreground'
                        : 'bg-border group-hover:bg-muted-foreground',
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
