'use client';

import { Button } from '@tale/ui/button';
import { useT } from '@tale/ui/i18n/client';
import { useInfiniteScroll } from '@tale/ui/use-infinite-scroll';
import type { RefObject } from 'react';

/** The end of a progressively rendered list. Scrolling preloads the next
 * window; the same action remains reachable by keyboard or without an observer. */
export function ListLoadMore({
  hasMore,
  onLoadMore,
  root,
  enabled = true,
}: {
  hasMore: boolean;
  onLoadMore: () => void;
  root?: RefObject<HTMLElement | null>;
  enabled?: boolean;
}) {
  const { t } = useT('common');
  const { sentinelRef } = useInfiniteScroll({
    hasMore,
    onLoadMore,
    isLoading: false,
    enabled,
    root,
    threshold: 200,
  });
  if (!hasMore) return null;
  return (
    <>
      <div ref={sentinelRef} className="h-px" aria-hidden="true" />
      <div className="bg-background sticky bottom-0 z-10 flex shrink-0 justify-center py-2">
        <Button variant="ghost" size="sm" onClick={onLoadMore}>
          {t('pagination.loadMore')}
        </Button>
      </div>
    </>
  );
}
