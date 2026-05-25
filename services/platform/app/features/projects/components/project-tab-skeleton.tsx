'use client';

import { Skeleton } from '@tale/ui/skeleton';

import { ContentArea } from '@/app/components/layout/content-area';

/**
 * Layout-shaped skeleton for project detail tabs. Mirrors the rhythm of a
 * settings page (sticky section header → form sections separated by
 * border-top dividers) so the loading state feels stable instead of
 * collapsing-then-expanding when real content arrives.
 *
 * Used at the route-layout level (`$projectId.tsx`) while the project
 * query resolves, and individual tabs can render it directly when their
 * own data is still pending.
 */
export function ProjectTabSkeleton() {
  return (
    <ContentArea variant="narrow" gap={6} className="py-4">
      {/* Sticky section header: title + description + action */}
      <div className="flex items-start justify-between gap-4 pb-2">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-3.5 w-80 max-w-full" />
        </div>
        <Skeleton className="h-8 w-32 shrink-0" />
      </div>

      {/* First form section — label + two stacked field skeletons */}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>

      {/* Divider + second form section */}
      <div className="mt-2 space-y-3 border-t pt-8">
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-64 max-w-full" />
        </div>
        <Skeleton className="h-9 w-full" />
      </div>

      {/* Divider + content rows */}
      <div className="mt-2 space-y-3 border-t pt-8">
        <Skeleton className="h-5 w-40" />
        <div className="divide-y rounded-lg border">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div key={idx} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="size-4 shrink-0" />
              <Skeleton className="h-4 max-w-[16rem] flex-1" />
              <Skeleton className="h-4 w-16 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </ContentArea>
  );
}
