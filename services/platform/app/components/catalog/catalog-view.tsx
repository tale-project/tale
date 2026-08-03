'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { SearchX } from 'lucide-react';
import { Fragment, type ComponentType, type ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';

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

/** Destructive alert for a failed listing, with an optional inline retry. */
export function CatalogLoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  const { t } = useT('common');
  return (
    <Alert
      variant="destructive"
      description={
        onRetry ? (
          <span className="inline-flex flex-wrap items-baseline gap-x-2">
            <span>{message}</span>
            <Button
              type="button"
              variant="link"
              className="text-foreground h-auto min-h-0 p-0 text-sm"
              onClick={onRetry}
            >
              {t('actions.tryAgain')}
            </Button>
          </span>
        ) : (
          message
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
