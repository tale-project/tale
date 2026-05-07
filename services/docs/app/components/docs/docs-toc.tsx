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
      className="sticky top-20 hidden max-h-[calc(100vh-6rem)] w-56 shrink-0 overflow-y-auto pl-4 xl:block"
    >
      <h3 className="text-fg-base mb-3 text-xs font-semibold tracking-wide uppercase">
        {t('onThisPage')}
      </h3>
      <ul className="flex flex-col gap-1.5 text-sm">
        {entries.map((entry) => (
          <li key={entry.id} className={entry.level === 3 ? 'pl-3' : undefined}>
            <a
              href={`#${entry.id}`}
              onClick={(e) => handleClick(e, entry.id)}
              className={cn(
                'block leading-tight transition-colors',
                activeId === entry.id
                  ? 'text-fg-base font-medium'
                  : 'text-fg-muted hover:text-fg-base',
              )}
            >
              {entry.text}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
