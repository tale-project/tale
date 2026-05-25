'use client';

import { HStack, Stack } from '@tale/ui/layout';
import { Skeleton } from '@tale/ui/skeleton';

/**
 * Mirrors `<UsageMetricsPage>`: header row (title + 3 selects), 4-card
 * summary grid, trend chart, then 3 stacked top-N tables. Heights and the
 * 4-column grid line up with the real layout so swapping the skeleton for
 * loaded data doesn't shift the page.
 */
export function UsageMetricsPageSkeleton() {
  return (
    <Stack gap={6} aria-busy="true">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-80 max-w-full" />
        </div>
        <HStack gap={2} className="flex-wrap">
          <Skeleton className="h-8 w-36 rounded-md" />
          <Skeleton className="h-8 w-36 rounded-md" />
          <Skeleton className="h-8 w-36 rounded-md" />
        </HStack>
      </div>
      <div className="border-border grid grid-cols-2 overflow-hidden rounded-lg border md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="border-border flex flex-col gap-2 border-r px-5 py-6 last:border-r-0"
          >
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-7 w-20" />
          </div>
        ))}
      </div>
      <Skeleton className="h-92 w-full rounded-md" />
      <div className="flex flex-col gap-8">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-66 w-full rounded-md" />
          </div>
        ))}
      </div>
    </Stack>
  );
}
