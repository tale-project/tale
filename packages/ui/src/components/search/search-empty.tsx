import { motion } from 'framer-motion';
import { Clock, History, Search, X } from 'lucide-react';

import { cn } from '../../lib/cn';
import type { RecentSearch, SearchCommandLabels } from './types';

interface SearchEmptyProps {
  recents: RecentSearch[];
  onPickRecent: (recent: RecentSearch) => void;
  onRemoveRecent: (query: string) => void;
  onClearRecents: () => void;
  /** When non-empty, the user has typed something below `minQueryLength`.
   *  Render a "keep typing" hint instead of recents. */
  shortQuery?: string;
  labels: SearchCommandLabels;
  reduceMotion: boolean;
}

export function SearchEmpty({
  recents,
  onPickRecent,
  onRemoveRecent,
  onClearRecents,
  shortQuery,
  labels,
  reduceMotion,
}: SearchEmptyProps) {
  const isShortQuery = !!shortQuery && shortQuery.length > 0;

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="px-4 py-6"
    >
      {isShortQuery ? (
        <div
          className="text-fg-muted mb-6 flex flex-col items-center justify-center gap-2 px-4 py-6 text-center"
          aria-live="polite"
        >
          <span className="border-border-base bg-bg-elevated/40 inline-flex size-10 items-center justify-center rounded-full border">
            <Search aria-hidden className="size-4" />
          </span>
          <p className="text-fg-base text-sm font-medium">
            {labels.keepTyping}
          </p>
        </div>
      ) : recents.length > 0 ? (
        <section aria-label={labels.recent} className="mb-6">
          <header className="mb-2 flex items-center justify-between px-1">
            <span className="text-fg-subtle inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wider uppercase">
              <History aria-hidden className="size-3.5" />
              {labels.recent}
            </span>
            <button
              type="button"
              onClick={onClearRecents}
              // `-mr-1.5` keeps the label edge aligned with the header while
              // the padding gives the control a >=24px touch target.
              className="text-fg-subtle hover:text-fg-base focus-visible:ring-fg-base/40 -mr-1.5 inline-flex min-h-6 items-center rounded px-1.5 py-1 text-[11px] transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              {labels.clearRecent}
            </button>
          </header>
          <ul role="list" className="flex flex-col gap-0.5">
            {recents.map((recent) => (
              <li
                key={recent.query + recent.savedAt}
                className="group flex items-center gap-1"
              >
                <button
                  type="button"
                  onClick={() => onPickRecent(recent)}
                  className={cn(
                    'text-fg-muted hover:text-fg-base hover:bg-bg-elevated/60 focus-visible:bg-bg-elevated focus-visible:ring-fg-base/40',
                    'flex flex-1 items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none',
                  )}
                >
                  <Clock aria-hidden className="size-3.5 shrink-0 opacity-60" />
                  <span className="truncate">{recent.query}</span>
                  {recent.title ? (
                    <span className="text-fg-subtle ml-auto truncate text-xs">
                      {recent.title}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemoveRecent(recent.query);
                  }}
                  aria-label={labels.removeRecent}
                  className="text-fg-subtle hover:text-fg-base hover:bg-bg-elevated focus-visible:ring-fg-base/40 size-7 shrink-0 rounded-md opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
                >
                  <X aria-hidden className="m-auto size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="text-fg-muted mb-6 flex flex-col items-center justify-center gap-2 px-4 py-6 text-center">
          <span className="border-border-base bg-bg-elevated/40 inline-flex size-10 items-center justify-center rounded-full border">
            <Search aria-hidden className="size-4" />
          </span>
          <p className="text-fg-base text-sm font-medium">{labels.empty}</p>
          <p className="text-fg-subtle max-w-xs text-xs leading-relaxed">
            {labels.emptyHint}
          </p>
        </div>
      )}
    </motion.div>
  );
}
