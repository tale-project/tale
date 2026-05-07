import * as Dialog from '@radix-ui/react-dialog';
import { cn } from '@tale/ui/cn';
import { useNavigate } from '@tanstack/react-router';
import { ArrowRight, FileText, Search, X } from 'lucide-react';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';

import { useDebounce } from '../hooks/use-debounce';
import { search } from './client';

interface SearchDialogProps {
  /** Current locale used to pick the right static index. */
  locale: string;
  /** Optional base URL for the static index files (defaults to `/`). */
  baseUrl?: string;
  /** Controlled open state. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Translatable labels. */
  labels?: Partial<{
    placeholder: string;
    empty: string;
    noResults: string;
    close: string;
    title: string;
  }>;
}

interface ResultRow {
  id: string;
  title: string;
  url: string;
  section?: string;
  score: number;
}

const DEFAULT_LABELS = {
  placeholder: 'Search documentation…',
  empty: 'Start typing to search.',
  noResults: 'No results.',
  close: 'Close search',
  title: 'Search',
};

export function SearchDialog({
  locale,
  baseUrl = '',
  open,
  onOpenChange,
  labels: labelOverrides,
}: SearchDialogProps) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 200);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const listboxId = useId();
  const optionIdPrefix = useId();
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!debounced.trim()) {
      setResults([]);
      setActive(0);
      return;
    }
    let cancelled = false;
    void search(locale, debounced, baseUrl).then((rows) => {
      if (cancelled) return;
      setResults(rows.slice(0, 25));
      setActive(0);
    });
    return () => {
      cancelled = true;
    };
  }, [debounced, locale, baseUrl]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setActive(0);
    }
  }, [open]);

  // Scroll the active option into view when arrowing through results.
  useEffect(() => {
    const node = optionRefs.current[active];
    if (node) node.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = results[active];
      if (target) {
        onOpenChange(false);
        // oxlint-disable-next-line typescript/no-explicit-any -- runtime navigation target
        void navigate({ to: target.url } as any);
      }
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="data-[state=open]:animate-in data-[state=open]:fade-in fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content
          aria-label={labels.title}
          className="border-border-base bg-bg-base fixed top-[15vh] left-1/2 z-50 flex w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-xl border shadow-2xl"
        >
          <Dialog.Title className="sr-only">{labels.title}</Dialog.Title>
          <div className="border-border-base flex items-center gap-2 border-b px-4">
            <Search aria-hidden className="text-fg-muted size-4 shrink-0" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              autoFocus
              placeholder={labels.placeholder}
              className="text-fg-base placeholder:text-fg-muted focus-visible:ring-fg-base/30 h-12 flex-1 rounded-md bg-transparent text-sm outline-none focus-visible:ring-1"
              aria-label={labels.placeholder}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={results.length > 0}
              aria-controls={listboxId}
              aria-activedescendant={
                results.length > 0 ? `${optionIdPrefix}-${active}` : undefined
              }
            />
            <Dialog.Close
              aria-label={labels.close}
              className="text-fg-muted hover:text-fg-base focus-visible:ring-fg-base/60 focus-visible:ring-offset-bg-base size-7 shrink-0 rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              <X aria-hidden className="size-4" />
            </Dialog.Close>
          </div>

          <ul
            id={listboxId}
            role="listbox"
            aria-label={labels.title}
            className="max-h-[50vh] overflow-y-auto py-2"
          >
            {!debounced.trim() ? (
              <li className="text-fg-muted px-4 py-6 text-center text-sm">
                {labels.empty}
              </li>
            ) : results.length === 0 ? (
              <li className="text-fg-muted px-4 py-6 text-center text-sm">
                {labels.noResults}
              </li>
            ) : (
              results.map((row, i) => (
                <li key={row.id}>
                  <button
                    type="button"
                    role="option"
                    id={`${optionIdPrefix}-${i}`}
                    aria-selected={i === active}
                    ref={(node) => {
                      optionRefs.current[i] = node;
                    }}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => {
                      onOpenChange(false);
                      // oxlint-disable-next-line typescript/no-explicit-any
                      void navigate({ to: row.url } as any);
                    }}
                    className={cn(
                      'group flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors',
                      i === active
                        ? 'bg-bg-elevated text-fg-base'
                        : 'text-fg-muted',
                    )}
                  >
                    <FileText
                      aria-hidden
                      className="size-4 shrink-0 opacity-70"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="text-fg-base block truncate font-medium">
                        {row.title}
                      </span>
                      {row.section ? (
                        <span className="block truncate text-xs opacity-70">
                          {row.section}
                        </span>
                      ) : null}
                    </span>
                    <ArrowRight
                      aria-hidden
                      className="size-3.5 shrink-0 opacity-0 transition-opacity group-aria-selected:opacity-100"
                    />
                  </button>
                </li>
              ))
            )}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
