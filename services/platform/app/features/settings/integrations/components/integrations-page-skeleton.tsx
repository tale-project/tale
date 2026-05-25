'use client';

import { Skeleton } from '@tale/ui/skeleton';

import {
  SettingsPageSkeleton,
  SettingsTabsSkeleton,
} from '@/app/features/settings/components/settings-skeleton';

/**
 * Mirrors the integrations page: outer Apps/MCP tabs + search/action row +
 * 6 integration card placeholders in a 1/2/3 column responsive grid.
 */
export function IntegrationsPageSkeleton() {
  return (
    <SettingsPageSkeleton>
      <div className="flex flex-col gap-4">
        <SettingsTabsSkeleton tabs={2} />
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-9 max-w-sm flex-1" />
          <Skeleton className="h-9 w-32 shrink-0" />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="border-border bg-card flex flex-col gap-3 rounded-xl border p-5"
            >
              <div className="flex items-start justify-between">
                <Skeleton className="size-11 rounded-lg" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          ))}
        </div>
      </div>
    </SettingsPageSkeleton>
  );
}
