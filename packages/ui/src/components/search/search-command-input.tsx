import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, Search, X } from 'lucide-react';
import type { KeyboardEvent } from 'react';

import { cn } from '../../lib/cn';
import type { SearchStatus } from './types';

interface SearchCommandInputProps {
  query: string;
  setQuery: (value: string) => void;
  status: SearchStatus;
  placeholder: string;
  closeLabel: string;
  loadingLabel: string;
  listboxId: string;
  optionIdPrefix: string;
  activeIndex: number;
  resultCount: number;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

/** The command header: a combobox-wired search input with a search⇄spinner
 *  icon swap and an explicit close button. */
export function SearchCommandInput({
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
}: SearchCommandInputProps) {
  return (
    <div className="border-border-base flex items-center gap-2 border-b px-4">
      <span
        className="text-fg-muted relative inline-flex size-5 shrink-0 items-center justify-center"
        aria-hidden
      >
        <Search
          className={cn(
            'size-4 transition-opacity duration-150',
            status === 'loading' ? 'opacity-0' : 'opacity-100',
          )}
        />
        <Loader2
          className={cn(
            'absolute size-4 transition-opacity duration-150',
            'animate-spin motion-reduce:animate-none',
            status === 'loading' ? 'opacity-100' : 'opacity-0',
          )}
        />
      </span>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
        placeholder={placeholder}
        className="text-fg-base placeholder:text-fg-muted h-12 flex-1 bg-transparent text-base outline-none focus:outline-none focus-visible:outline-none"
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
