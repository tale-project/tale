'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
} from 'react';

import { useRestoreFocus } from '../../hooks/use-restore-focus';
import { cn } from '../../lib/cn';
import { FALLBACK_GROUP, humanizeGroupKey } from './group-by';
import { SearchCommandInput } from './search-command-input';
import { SearchEmpty } from './search-empty';
import { SearchFooter } from './search-footer';
import { type RenderResultArgs, SearchResultList } from './search-result-list';
import type {
  BreadcrumbResolver,
  ResultIconResolver,
} from './search-result-row';
import { SearchSkeleton } from './search-skeleton';
import type { SearchCommandLabels, SearchResult, SearchSource } from './types';
import { useSearchCommand } from './use-search-command';
import { useSearchCommandLabels } from './use-search-command-labels';

export interface SearchCommandProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pluggable data source (a hook). See {@link SearchSource}. */
  source: SearchSource;
  /** Caller-owned navigation when a result is chosen. */
  onSelect: (result: SearchResult) => void;
  /** Override surface-specific labels; the rest come from the `search` i18n
   *  namespace via {@link useSearchCommandLabels}. */
  labels?: Partial<SearchCommandLabels>;
  minQueryLength?: number;
  debounceMs?: number;
  /** localStorage namespace for recents (e.g. `tale.platform.chat.…`). Omit
   *  to disable recents for this surface. */
  recentsStorageKey?: string;
  getGroupKey?: (result: SearchResult) => string;
  getGroupLabel?: (key: string) => string;
  resultIcon?: ResultIconResolver;
  getBreadcrumb?: BreadcrumbResolver;
  renderResult?: (args: RenderResultArgs) => React.ReactNode;
  /** Optional row between the results list and the keyboard footer — e.g. a
   *  scoped palette linking out to global search. */
  footerAccessory?: React.ReactNode;
}

/**
 * Shared search command palette. Surface-agnostic: the {@link SearchSource}
 * decides where results come from (static MiniSearch index, a Convex
 * paginated query, a RAG action). Used by both the docs site and the platform
 * so every search "works the same way".
 */
export function SearchCommand({
  open,
  onOpenChange,
  source,
  onSelect,
  labels: labelOverrides,
  minQueryLength = 2,
  debounceMs = 250,
  recentsStorageKey,
  getGroupKey,
  getGroupLabel,
  resultIcon,
  getBreadcrumb,
  renderResult,
  footerAccessory,
}: SearchCommandProps) {
  const labels = useSearchCommandLabels(labelOverrides);
  const reduceMotion = useReducedMotion() ?? false;
  // The palette opens programmatically (Cmd/Ctrl+K) with no Dialog.Trigger, so
  // Radix has nothing to restore focus to on close and it falls to <body>
  // (WCAG 2.4.3). Capture the opener and refocus it on close.
  const restoreFocus = useRestoreFocus(open);

  const select = useCallback(
    (result: SearchResult) => {
      onOpenChange(false);
      onSelect(result);
    },
    [onOpenChange, onSelect],
  );

  // Localise the catch-all group header while delegating real keys to the
  // caller's resolver (docs maps section slugs to titles; others humanise).
  const resolveGroupLabel = useCallback(
    (key: string): string =>
      key === FALLBACK_GROUP
        ? labels.resultsGroup
        : getGroupLabel
          ? getGroupLabel(key)
          : humanizeGroupKey(key),
    [getGroupLabel, labels.resultsGroup],
  );

  const controller = useSearchCommand({
    source,
    open,
    minQueryLength,
    debounceMs,
    getGroupKey,
    getGroupLabel: resolveGroupLabel,
    recentsStorageKey,
    onSelect: select,
  });

  const {
    query,
    setQuery,
    effectiveQuery,
    status,
    results,
    groups,
    visualResults,
    terms,
    activeIndex,
    setActiveIndex,
    select: onResultSelect,
    recents,
    pickRecent,
    removeRecent,
    clearRecents,
    canLoadMore,
    loadMore,
    isLoadingMore,
    isShortQuery,
    showEmptyState,
    showSkeleton,
    showNoResults,
    showError,
  } = controller;

  const listboxId = useId();
  const optionIdPrefix = useId();
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  // Reset scroll to the top when the result *set* changes (new query). Done
  // explicitly on the container — NOT via scrollIntoView on activeIndex —
  // because the latter would fire on hover too and steal scroll mid-scroll.
  useEffect(() => {
    const lb = listboxRef.current;
    if (lb) lb.scrollTop = 0;
  }, [effectiveQuery]);

  // Scroll a row into view only on intentional keyboard nav (RAF lets the
  // row position settle after the state update).
  const scrollRowIntoView = (index: number) => {
    requestAnimationFrame(() => {
      const node = optionRefs.current[index];
      if (node) node.scrollIntoView({ block: 'nearest' });
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (visualResults.length === 0) return;
      const next = Math.min(activeIndex + 1, visualResults.length - 1);
      setActiveIndex(next);
      scrollRowIntoView(next);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (visualResults.length === 0) return;
      const next = Math.max(activeIndex - 1, 0);
      setActiveIndex(next);
      scrollRowIntoView(next);
    } else if (event.key === 'Enter') {
      // Ignore Enter while an IME composition is in progress, so composing
      // users can commit candidate text without it selecting a result.
      if (event.nativeEvent.isComposing) return;
      event.preventDefault();
      const target = visualResults[activeIndex];
      if (target) onResultSelect(target);
    }
  };

  // Paginated sources: load the next page when the sentinel scrolls into view.
  useEffect(() => {
    if (!open || !canLoadMore || !loadMore || isLoadingMore) return undefined;
    const sentinel = loadMoreRef.current;
    const root = listboxRef.current;
    if (!sentinel || !root) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        // Guard against firing a second page while one is already in flight.
        if (entries.some((e) => e.isIntersecting) && !isLoadingMore) loadMore();
      },
      { root, rootMargin: '120px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [open, canLoadMore, loadMore, isLoadingMore, visualResults.length]);

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
                className="fixed inset-0 z-50 bg-black/50 backdrop-blur-md"
              />
            </Dialog.Overlay>
            <Dialog.Content
              asChild
              aria-modal="true"
              aria-label={labels.title}
              onCloseAutoFocus={restoreFocus}
            >
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
                <Dialog.Description className="sr-only">
                  {labels.emptyHint}
                </Dialog.Description>

                <SearchCommandInput
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
                  ref={listboxRef}
                  id={listboxId}
                  role="listbox"
                  aria-label={labels.title}
                  aria-busy={status === 'loading'}
                  className="max-h-[58vh] min-h-72 overflow-y-auto"
                >
                  {showEmptyState ? (
                    <motion.div
                      key="empty"
                      initial={reduceMotion ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: reduceMotion ? 0 : 0.15 }}
                    >
                      <SearchEmpty
                        recents={recents}
                        shortQuery={isShortQuery ? query.trim() : undefined}
                        onPickRecent={pickRecent}
                        onRemoveRecent={removeRecent}
                        onClearRecents={clearRecents}
                        labels={labels}
                        reduceMotion={reduceMotion}
                      />
                    </motion.div>
                  ) : showSkeleton ? (
                    <motion.div
                      key="skeleton"
                      initial={reduceMotion ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: reduceMotion ? 0 : 0.12 }}
                      aria-hidden
                      data-testid="search-skeleton"
                    >
                      <SearchSkeleton reduceMotion={reduceMotion} />
                    </motion.div>
                  ) : showError ? (
                    <motion.div
                      key="error"
                      initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: reduceMotion ? 0 : 0.18 }}
                      className="text-fg-muted flex min-h-72 flex-col items-center justify-center px-6 text-center"
                      role="alert"
                    >
                      <p className="text-fg-base text-sm font-medium">
                        {labels.errorTitle}
                      </p>
                      <p className="text-fg-subtle mt-1 text-xs">
                        {labels.errorHint}
                      </p>
                    </motion.div>
                  ) : showNoResults ? (
                    <motion.div
                      key="no-results"
                      initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: reduceMotion ? 0 : 0.18 }}
                      className="text-fg-muted flex min-h-72 flex-col items-center justify-center px-6 text-center"
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
                      transition={{ duration: reduceMotion ? 0 : 0.15 }}
                    >
                      <SearchResultList
                        groups={groups}
                        terms={terms}
                        activeIndex={activeIndex}
                        setActiveIndex={setActiveIndex}
                        onSelect={onResultSelect}
                        optionIdPrefix={optionIdPrefix}
                        optionRefs={optionRefs}
                        resultIcon={resultIcon}
                        getBreadcrumb={getBreadcrumb}
                        renderResult={renderResult}
                      />
                      {canLoadMore ? (
                        <div ref={loadMoreRef} aria-hidden className="h-1" />
                      ) : null}
                    </motion.div>
                  )}
                </div>

                {footerAccessory}

                <SearchFooter
                  resultCount={
                    controller.showResults && status === 'ready'
                      ? results.length
                      : null
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
