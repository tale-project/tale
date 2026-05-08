import { cn } from '@tale/ui/cn';
import { motion } from 'framer-motion';
import { Clock, CornerDownLeft, History, Search, X } from 'lucide-react';

import type { RecentSearch } from './types';

interface SearchEmptyProps {
  recents: RecentSearch[];
  onPickRecent: (recent: RecentSearch) => void;
  onRemoveRecent: (query: string) => void;
  onClearRecents: () => void;
  labels: {
    empty: string;
    emptyHint: string;
    recent: string;
    clearRecent: string;
    removeRecent: string;
    tipsTitle: string;
    tipNavigate: string;
    tipSelect: string;
    tipClose: string;
  };
  reduceMotion: boolean;
}

export function SearchEmpty({
  recents,
  onPickRecent,
  onRemoveRecent,
  onClearRecents,
  labels,
  reduceMotion,
}: SearchEmptyProps) {
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="px-4 py-6"
    >
      {recents.length > 0 ? (
        <section aria-label={labels.recent} className="mb-6">
          <header className="mb-2 flex items-center justify-between px-1">
            <span className="text-fg-subtle inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wider uppercase">
              <History aria-hidden className="size-3.5" />
              {labels.recent}
            </span>
            <button
              type="button"
              onClick={onClearRecents}
              className="text-fg-subtle hover:text-fg-base focus-visible:ring-fg-base/40 rounded text-[11px] transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              {labels.clearRecent}
            </button>
          </header>
          <ul className="flex flex-col gap-0.5">
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

      <section aria-label={labels.tipsTitle}>
        <header className="mb-2 px-1">
          <span className="text-fg-subtle text-[11px] font-semibold tracking-wider uppercase">
            {labels.tipsTitle}
          </span>
        </header>
        <ul className="text-fg-muted grid grid-cols-1 gap-2 px-1 text-xs sm:grid-cols-3">
          <li className="flex items-center gap-2">
            <KeyHint>↑</KeyHint>
            <KeyHint>↓</KeyHint>
            <span>{labels.tipNavigate}</span>
          </li>
          <li className="flex items-center gap-2">
            <KeyHint>
              <CornerDownLeft className="size-3" />
            </KeyHint>
            <span>{labels.tipSelect}</span>
          </li>
          <li className="flex items-center gap-2">
            <KeyHint>esc</KeyHint>
            <span>{labels.tipClose}</span>
          </li>
        </ul>
      </section>
    </motion.div>
  );
}

function KeyHint({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="border-border-base bg-bg-base text-fg-base inline-flex h-5 min-w-5 items-center justify-center rounded border px-1 font-mono text-[10px]">
      {children}
    </kbd>
  );
}
