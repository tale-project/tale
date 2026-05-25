'use client';

import { HStack, Stack } from '@tale/ui/layout';
import { Skeleton } from '@tale/ui/skeleton';

/**
 * Mirrors `<FeedbackMetricsPage>` while stats load:
 *   header (title + description + period select) →
 *   summary cards (3-up) →
 *   arena summary card →
 *   3 stacked top-N table panels →
 *   recent feedback table.
 */
export function FeedbackMetricsPageSkeleton() {
  return (
    <Stack gap={6} aria-busy="true">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-80 max-w-full" />
        </div>
        <HStack gap={2} className="flex-wrap">
          <Skeleton className="h-8 w-36 rounded-md" />
        </HStack>
      </div>
      <div className="border-border grid grid-cols-1 overflow-hidden rounded-lg border md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="border-border flex flex-col gap-2 border-r px-5 py-6 last:border-r-0"
          >
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-7 w-20" />
          </div>
        ))}
      </div>
      <Skeleton className="h-32 w-full rounded-lg" />
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
