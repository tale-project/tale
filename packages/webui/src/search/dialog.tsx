import * as Dialog from '@radix-ui/react-dialog';
import { cn } from '@tale/ui/cn';
import { useNavigate } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CornerDownLeft, Loader2, Search, X } from 'lucide-react';
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  loadRecentSearches,
  removeRecentSearch,
  saveRecentSearch,
  clearRecentSearches,
} from './recent-searches';
import { SearchEmpty } from './search-empty';
import { SearchResults } from './search-results';
import type { RecentSearch, SearchResult } from './types';
import { useDocSearch } from './use-search';

interface SearchDialogProps {
  /** Current locale used to pick the right static index. */
  locale: string;
  /** Optional base URL for the static index files (defaults to `/`). */
  baseUrl?: string;
  /** Controlled open state. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Translatable labels — every visible string is overrideable. */
  labels?: Partial<SearchDialogLabels>;
  /** Map a section key (e.g. "platform") to a localised label. Falls back to
   *  a humanised version of the key when omitted. */
  sectionLabel?: (sectionKey: string) => string;
}

export interface SearchDialogLabels {
  title: string;
  placeholder: string;
  empty: string;
  emptyHint: string;
  noResultsTitle: string;
  noResultsHint: string;
  loading: string;
  close: string;
  recent: string;
  clearRecent: string;
  removeRecent: string;
  tipsTitle: string;
  tipNavigate: string;
  tipSelect: string;
  tipClose: string;
  resultCount: (count: number) => string;
}

const DEFAULT_LABELS: SearchDialogLabels = {
  title: 'Search',
  placeholder: 'Search documentation…',
  empty: 'Start typing to search the docs.',
  emptyHint: 'Find guides, references, and concepts across every section.',
  noResultsTitle: 'No results.',
  noResultsHint: 'Try different keywords or browse the navigation.',
  loading: 'Searching…',
  close: 'Close search',
  recent: 'Recent searches',
  clearRecent: 'Clear',
  removeRecent: 'Remove',
  tipsTitle: 'Tips',
  tipNavigate: 'to navigate',
  tipSelect: 'to open',
  tipClose: 'to dismiss',
  resultCount: (count) =>
    count === 1 ? '1 result' : `${count.toLocaleString()} results`,
};

export function SearchDialog({
  locale,
  baseUrl = '',
  open,
  onOpenChange,
  labels: labelOverrides,
  sectionLabel,
}: SearchDialogProps) {
  const labels = useMemo(
    () => ({ ...DEFAULT_LABELS, ...labelOverrides }),
    [labelOverrides],
  );
  const reduceMotion = useReducedMotion() ?? false;
  const navigate = useNavigate();

  const { query, setQuery, results, terms, status } = useDocSearch({
    locale,
    baseUrl,
  });
  const [activeIndex, setActiveIndex] = useState(0);
  const [recents, setRecents] = useState<RecentSearch[]>([]);

  const listboxId = useId();
  const optionIdPrefix = useId();
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Hydrate recents from localStorage every time the dialog opens.
  useEffect(() => {
    if (open) setRecents(loadRecentSearches());
  }, [open]);

  // Reset state on close so the next open is a clean slate.
  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [open, setQuery]);

  // Reset active index whenever the result set changes so the highlight
  // doesn't point past the end of the list.
  useEffect(() => {
    setActiveIndex(0);
  }, [results]);

  // Scroll the active option into view when the user arrows through results.
  useEffect(() => {
    const node = optionRefs.current[activeIndex];
    if (node) node.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const select = useCallback(
    (result: SearchResult) => {
      setRecents(
        saveRecentSearch({
          query: query.trim() || result.title,
          url: result.url,
          title: result.title,
        }),
      );
      onOpenChange(false);
      // oxlint-disable-next-line typescript/no-explicit-any -- runtime nav target
      void navigate({ to: result.url } as any);
    },
    [query, navigate, onOpenChange],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (results.length === 0) return;
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (results.length === 0) return;
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = results[activeIndex];
      if (target) select(target);
    }
  };

  const trimmed = query.trim();
  const showResults = trimmed.length > 0 && status !== 'idle';
  const showEmptyState = !showResults;
  const showNoResults =
    showResults && status === 'ready' && results.length === 0;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                key="search-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{
                  duration: reduceMotion ? 0 : 0.18,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="fixed inset-0 z-40 bg-black/50 backdrop-blur-md"
              />
            </Dialog.Overlay>
            <Dialog.Content asChild aria-label={labels.title}>
              <motion.div
                key="search-dialog"
                initial={
                  reduceMotion
                    ? { opacity: 0 }
                    : { opacity: 0, y: -8, scale: 0.98 }
                }
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={
                  reduceMotion
                    ? { opacity: 0 }
                    : { opacity: 0, y: -4, scale: 0.99 }
                }
                transition={{
                  duration: reduceMotion ? 0 : 0.22,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className={cn(
                  'border-border-base bg-bg-base/95 fixed top-[12vh] left-1/2 z-50 flex w-[min(680px,calc(100vw-2rem))]',
                  '-translate-x-1/2 flex-col overflow-hidden rounded-2xl border shadow-2xl backdrop-blur-xl',
                )}
              >
                <Dialog.Title className="sr-only">{labels.title}</Dialog.Title>

                <SearchHeader
                  query={query}
                  setQuery={setQuery}
                  status={status}
                  closeLabel={labels.close}
                  placeholder={labels.placeholder}
                  loadingLabel={labels.loading}
                  listboxId={listboxId}
                  optionIdPrefix={optionIdPrefix}
                  activeIndex={activeIndex}
                  resultCount={results.length}
                  onKeyDown={onKeyDown}
                />

                <div
                  id={listboxId}
                  role="listbox"
                  aria-label={labels.title}
                  aria-busy={status === 'loading'}
                  className="max-h-[58vh] min-h-45 overflow-y-auto"
                >
                  <AnimatePresence mode="wait" initial={false}>
                    {showEmptyState ? (
                      <motion.div
                        key="empty"
                        initial={reduceMotion ? false : { opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: reduceMotion ? 0 : 0.15 }}
                      >
                        <SearchEmpty
                          recents={recents}
                          onPickRecent={(recent) => setQuery(recent.query)}
                          onRemoveRecent={(toRemove) =>
                            setRecents(removeRecentSearch(toRemove))
                          }
                          onClearRecents={() => {
                            clearRecentSearches();
                            setRecents([]);
                          }}
                          labels={labels}
                          reduceMotion={reduceMotion}
                        />
                      </motion.div>
                    ) : showNoResults ? (
                      <motion.div
                        key="no-results"
                        initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: reduceMotion ? 0 : 0.18 }}
                        className="text-fg-muted px-6 py-10 text-center"
                        aria-live="polite"
                      >
                        <p className="text-fg-base text-sm font-medium">
                          {labels.noResultsTitle}
                        </p>
                        <p className="text-fg-subtle mt-1 text-xs">
                          {labels.noResultsHint}
                        </p>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="results"
                        initial={reduceMotion ? false : { opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: reduceMotion ? 0 : 0.15 }}
                      >
                        <SearchResults
                          results={results}
                          terms={terms}
                          activeIndex={activeIndex}
                          setActiveIndex={setActiveIndex}
                          onSelect={select}
                          sectionLabel={sectionLabel}
                          optionIdPrefix={optionIdPrefix}
                          optionRefs={optionRefs}
                          reduceMotion={reduceMotion}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <SearchFooter
                  resultCount={
                    showResults && status === 'ready' ? results.length : null
                  }
                  resultCountLabel={labels.resultCount}
                  tips={{
                    navigate: labels.tipNavigate,
                    select: labels.tipSelect,
                    close: labels.tipClose,
                  }}
                />
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}

interface SearchHeaderProps {
  query: string;
  setQuery: (value: string) => void;
  status: 'idle' | 'loading' | 'ready' | 'error';
  placeholder: string;
  closeLabel: string;
  loadingLabel: string;
  listboxId: string;
  optionIdPrefix: string;
  activeIndex: number;
  resultCount: number;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

function SearchHeader({
  query,
  setQuery,
  status,
  placeholder,
  closeLabel,
  loadingLabel,
  listboxId,
  optionIdPrefix,
  activeIndex,
  resultCount,
  onKeyDown,
}: SearchHeaderProps) {
  return (
    <div className="border-border-base flex items-center gap-2 border-b px-4">
      <span className="text-fg-muted relative inline-flex size-5 shrink-0 items-center justify-center">
        <AnimatePresence mode="wait" initial={false}>
          {status === 'loading' ? (
            <motion.span
              key="loading"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.12 }}
              aria-hidden
            >
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
            </motion.span>
          ) : (
            <motion.span
              key="idle"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.12 }}
              aria-hidden
            >
              <Search className="size-4" />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
        placeholder={placeholder}
        className="text-fg-base placeholder:text-fg-muted h-12 flex-1 bg-transparent text-sm outline-none focus:outline-none focus-visible:outline-none"
        aria-label={placeholder}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={resultCount > 0}
        aria-controls={listboxId}
        aria-activedescendant={
          resultCount > 0 ? `${optionIdPrefix}-${activeIndex}` : undefined
        }
      />
      <span className="sr-only" aria-live="polite">
        {status === 'loading' ? loadingLabel : ''}
      </span>
      <Dialog.Close
        aria-label={closeLabel}
        className="text-fg-muted hover:text-fg-base hover:bg-bg-elevated focus-visible:ring-fg-base/60 focus-visible:ring-offset-bg-base inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <X aria-hidden className="size-4" />
      </Dialog.Close>
    </div>
  );
}

interface SearchFooterProps {
  resultCount: number | null;
  resultCountLabel: (count: number) => string;
  tips: { navigate: string; select: string; close: string };
}

function SearchFooter({
  resultCount,
  resultCountLabel,
  tips,
}: SearchFooterProps) {
  return (
    <div className="border-border-base bg-bg-elevated/40 text-fg-subtle flex items-center justify-between gap-3 border-t px-4 py-2 text-[11px]">
      <ul className="flex items-center gap-3">
        <li className="hidden items-center gap-1 sm:inline-flex">
          <FooterKey>↑</FooterKey>
          <FooterKey>↓</FooterKey>
          <span>{tips.navigate}</span>
        </li>
        <li className="inline-flex items-center gap-1">
          <FooterKey>
            <CornerDownLeft className="size-3" />
          </FooterKey>
          <span>{tips.select}</span>
        </li>
        <li className="hidden items-center gap-1 sm:inline-flex">
          <FooterKey>esc</FooterKey>
          <span>{tips.close}</span>
        </li>
      </ul>
      <span aria-live="polite" className="tabular-nums">
        {resultCount !== null ? resultCountLabel(resultCount) : null}
      </span>
    </div>
  );
}

function FooterKey({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="border-border-base bg-bg-base text-fg-base inline-flex h-4 min-w-4 items-center justify-center rounded border px-1 font-mono text-[10px]">
      {children}
    </kbd>
  );
}
