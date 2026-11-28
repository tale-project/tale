'use client';

import { Loader2 } from 'lucide-react';

import { useFocusHandoff } from '../../hooks/use-focus-handoff';
import { Button } from '../primitives/button';

interface SearchRetryProps {
  label: string;
  retrying: boolean;
  onRetry: () => void;
  /** Takes the focus when the answer replaces a focused **Try again**. */
  onFocusLost: () => void;
}

/**
 * **Try again** on a failed search, the way `CatalogLoadError` offers it:
 * busy, not gone, while the retry runs. A disabled button would drop the
 * focus of the reader who pressed it, so it stays focusable and inert with
 * its spinner. When the answer takes it away while it holds the focus, the
 * focus goes to `onFocusLost` instead of the page.
 */
export function SearchRetry({
  label,
  retrying,
  onRetry,
  onFocusLost,
}: SearchRetryProps) {
  const setRetryRow = useFocusHandoff<HTMLSpanElement>(onFocusLost);
  return (
    <span ref={setRetryRow} className="inline-flex">
      <Button
        type="button"
        variant="link"
        className="h-auto min-h-0 p-0 text-xs"
        icon={retrying ? Loader2 : undefined}
        iconClassName="size-3.5 animate-spin motion-reduce:animate-none"
        aria-busy={retrying || undefined}
        aria-disabled={retrying || undefined}
        onClick={retrying ? undefined : onRetry}
      >
        {label}
      </Button>
    </span>
  );
}
