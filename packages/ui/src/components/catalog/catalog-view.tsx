'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import { useT } from '@tale/ui/i18n/client';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Loader2, SearchX } from 'lucide-react';
import {
  Fragment,
  type ComponentType,
  type Key,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { CatalogGridSkeleton } from './catalog-card-skeleton';
import { CatalogGrid } from './catalog-grid';

/**
 * The five states every card catalog goes through, in one place: loading,
 * listing-failed, nothing-exists-yet, nothing-matches-the-filters, and the
 * grid itself.
 *
 * Before this component each surface hand-rolled them, and each got a
 * different subset wrong — two naked `h-24` boxes that matched nothing for a
 * loading state, and a bare centered `<Stack>` that conflated "you have no
 * skills" with "your search found none". The distinction matters: the first
 * needs a create CTA, the second needs the search reset and must NOT offer to
 * create anything.
 *
 * The skeleton is shape-matched (`CatalogGridSkeleton` mirrors `CatalogCard`'s
 * footprint), so resolving the query never shifts layout.
 */

interface CatalogViewEmpty {
  /**
   * Required, not optional: an iconless empty state reads as a rendering bug
   * next to its sibling states, and making every catalog pass one is the only
   * way none can quietly ship without it.
   */
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: ReactNode;
  /** The create CTA. Shown ONLY in the nothing-exists-yet state. */
  action?: ReactNode;
}

interface CatalogViewProps<T> {
  /** True while the listing is in flight. */
  isPending: boolean;
  /** True when the listing failed outright (no data to show). */
  isError?: boolean;
  /** Human-readable listing failure — the failure only; retry is a control. */
  errorMessage?: string;
  /** Refetch the listing. Renders an inline "Try again" link when set. */
  onRetry?: () => void;
  /** The items that survived search + facets. */
  items: readonly T[];
  /**
   * Whether ANY item exists before narrowing. This is what separates the two
   * empty states, so it must be the pre-filter count — not `items.length`.
   */
  hasItems: boolean;
  /** Stable key per item. */
  itemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  /** Copy for the nothing-exists-yet state. */
  empty: CatalogViewEmpty;
  /** How many placeholder cards to show while loading. */
  skeletonCards?: number;
  /** Reserve the card footer / corner menu in the skeleton (see CatalogCard). */
  skeletonFooter?: boolean;
  skeletonMenu?: boolean;
  className?: string;
}

/**
 * Destructive alert for a failed listing, with an optional inline retry.
 * `isRetrying` marks the retry busy while it runs, for a host that keeps
 * the alert up until the request settles — a refresh of rows that stay on
 * screen, rather than a first read that goes back to its loading state.
 *
 * A host whose read can fail again under the alert (a background refresh)
 * passes a new `failureKey` for each failure: the message is written afresh
 * inside the same live region, so the failure is announced again, while
 * **Try again** keeps its node — and the focus a reader may have put on it.
 * When a refresh that worked takes the alert away while it holds focus,
 * `onFocusLost` gets the focus instead of the page; focus the reader moved
 * elsewhere in the meantime stays where it is.
 */
export function CatalogLoadError({
  message,
  onRetry,
  isRetrying = false,
  failureKey,
  onFocusLost,
}: {
  message: string;
  onRetry?: () => void;
  isRetrying?: boolean;
  failureKey?: Key;
  onFocusLost?: () => void;
}) {
  const { t } = useT('common');
  const [retryRow, setRetryRow] = useState<HTMLSpanElement | null>(null);
  // Read as the alert leaves, so a host re-rendering with a new callback
  // is never mistaken for the alert going away.
  const onFocusLostRef = useRef(onFocusLost);
  useLayoutEffect(() => {
    onFocusLostRef.current = onFocusLost;
  });
  // The cleanup runs before React detaches the alert, while the focus is
  // still inside it; the host's target takes it a frame later.
  useLayoutEffect(() => {
    if (retryRow === null) return undefined;
    return () => {
      const handoff = onFocusLostRef.current;
      if (handoff !== undefined && retryRow.contains(document.activeElement)) {
        requestAnimationFrame(handoff);
      }
    };
  }, [retryRow]);
  return (
    <Alert
      variant="destructive"
      description={
        onRetry ? (
          <span
            ref={setRetryRow}
            className="inline-flex flex-wrap items-baseline gap-x-2"
          >
            <span key={failureKey}>{message}</span>
            <Button
              type="button"
              variant="link"
              className="text-foreground h-auto min-h-0 p-0 text-sm"
              // Busy, not gone: `isLoading` would disable the button natively
              // and drop a focused retry's focus — also when the host starts
              // the request itself (a refetch as the tab regains focus). It
              // stays focusable and inert instead, with Button's own spinner.
              icon={isRetrying ? Loader2 : undefined}
              iconClassName="animate-spin motion-reduce:animate-none"
              aria-busy={isRetrying || undefined}
              aria-disabled={isRetrying || undefined}
              onClick={isRetrying ? undefined : onRetry}
            >
              {t('actions.tryAgain')}
            </Button>
          </span>
        ) : (
          <span key={failureKey}>{message}</span>
        )
      }
    />
  );
}

export function CatalogView<T>({
  isPending,
  isError = false,
  errorMessage,
  onRetry,
  items,
  hasItems,
  itemKey,
  renderItem,
  empty,
  skeletonCards,
  skeletonFooter,
  skeletonMenu,
  className,
}: CatalogViewProps<T>) {
  const { t } = useT('common');

  if (isError) {
    return (
      <div className={className}>
        <CatalogLoadError message={errorMessage ?? ''} onRetry={onRetry} />
      </div>
    );
  }

  if (isPending) {
    return (
      <div className={className}>
        <Skeletonize loading>
          <CatalogGridSkeleton
            cards={skeletonCards}
            footer={skeletonFooter}
            menu={skeletonMenu}
          />
        </Skeletonize>
      </div>
    );
  }

  if (items.length === 0) {
    // Narrowed to nothing is not the same as owning nothing: offer the search
    // reset, never the create CTA, or the reader is told to create a second
    // copy of something they already have.
    return (
      <div className={className}>
        {hasItems ? (
          <EmptyState
            // A crossed-out magnifier, not the surface's own icon: this state
            // is about the search, and reusing the zero-data icon made the two
            // states look identical at a glance.
            icon={SearchX}
            title={t('search.noResults')}
            description={t('search.tryAdjusting')}
          />
        ) : (
          <EmptyState
            icon={empty.icon}
            title={empty.title}
            description={empty.description}
            action={empty.action}
          />
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      <CatalogGrid>
        {/* Keyed Fragment, not a wrapper div: the cards must stay direct grid
            children or every equal-height guarantee in `CatalogCard` is lost. */}
        {items.map((item) => (
          <Fragment key={itemKey(item)}>{renderItem(item)}</Fragment>
        ))}
      </CatalogGrid>
    </div>
  );
}
