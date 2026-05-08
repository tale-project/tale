import { cn } from '@tale/ui/cn';
import type { TocEntry } from '@tale/webui/markdown/extract-toc';
import { useEffect, useState } from 'react';

import { useT } from '@/lib/i18n/client';

interface DocsTocProps {
  entries: TocEntry[];
}

/**
 * Right-rail "On this page" outline with scroll-spy. Highlights the
 * heading currently nearest to the top of the viewport.
 */
export function DocsToc({ entries }: DocsTocProps) {
  const { t } = useT('docs');
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (entries.length === 0) return undefined;
    const observer = new IntersectionObserver(
      (observed) => {
        const visible = observed
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: '0px 0px -70% 0px', threshold: [0, 1] },
    );
    for (const entry of entries) {
      const el = document.getElementById(entry.id);
      if (el) observer.observe(el);
    }
    // Force-activate the last heading once we hit the bottom of the page,
    // because the IntersectionObserver's bottom-30% trigger zone misses
    // headings that have already scrolled past it.
    const onScroll = () => {
      const scrolledToBottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 2;
      if (scrolledToBottom) {
        const last = entries[entries.length - 1];
        if (last) setActiveId(last.id);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', onScroll);
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
