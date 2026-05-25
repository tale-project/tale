'use client';

import { HStack, Stack } from '@tale/ui/layout';
import { Skeleton } from '@tale/ui/skeleton';

import { AdaptiveHeaderRoot } from '@/app/components/layout/adaptive-header';
import { ContentArea } from '@/app/components/layout/content-area';

export function SkillDetailSkeleton() {
  return (
    <>
      <AdaptiveHeaderRoot>
        <HStack gap={2} align="center" className="p-4">
          <Skeleton className="size-8 rounded-md" />
          <Skeleton className="h-6 w-48" />
          <div className="flex-1" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-20" />
        </HStack>
      </AdaptiveHeaderRoot>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <aside className="border-border hidden w-64 shrink-0 overflow-y-auto border-r p-3 md:block">
          <Skeleton className="mb-2 ml-1 h-3 w-16" />
          <Stack gap={0} className="space-y-0.5">
            {Array.from({ length: 7 }).map((_, idx) => (
              <div
                key={idx}
                className="flex items-center gap-1.5 rounded-md px-2 py-1.5"
              >
                <Skeleton className="size-3.5 shrink-0 rounded" />
                <Skeleton
                  className="h-3.5"
                  style={{ width: `${55 + ((idx * 13) % 35)}%` }}
                />
              </div>
            ))}
          </Stack>
        </aside>
        <aside className="border-border hidden w-72 shrink-0 overflow-y-auto border-r p-3 md:block">
          <Skeleton className="mb-2 ml-1 h-3 w-16" />
          <div className="flex items-center gap-1.5 rounded-md px-2 py-1.5">
            <Skeleton className="size-3.5 shrink-0 rounded" />
            <Skeleton className="h-3.5 w-20" />
          </div>
          {Array.from({ length: 3 }).map((_, groupIdx) => (
            <div key={groupIdx} className="mt-2">
              <Skeleton className="ml-2 h-3 w-20" />
              <Stack gap={0} className="mt-0.5">
                {Array.from({ length: 2 + (groupIdx % 2) }).map(
                  (__, fileIdx) => (
                    <div
                      key={fileIdx}
                      className="ml-3 flex items-center gap-1.5 rounded-md px-2 py-1"
                    >
                      <Skeleton className="size-3 shrink-0 rounded" />
                      <Skeleton
                        className="h-3"
                        style={{ width: `${50 + ((fileIdx * 17) % 35)}%` }}
                      />
                    </div>
                  ),
                )}
              </Stack>
            </div>
          ))}
          <Skeleton className="mt-4 ml-1 h-3 w-40" />
        </aside>
        <ContentArea className="min-w-0 flex-1">
          <Stack gap={6} className="p-4">
            <HStack
              gap={4}
              align="center"
              className="border-border bg-muted/30 rounded-md border px-4 py-2"
            >
              {Array.from({ length: 4 }).map((_, idx) => (
                <Stack key={idx} gap={1}>
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-24" />
                </Stack>
              ))}
            </HStack>
            {Array.from({ length: 5 }).map((_, idx) => (
              <Stack key={idx} gap={3}>
                <Skeleton className="h-4 w-32" />
                <Skeleton
                  className="w-full"
                  style={{ height: idx === 1 ? '18rem' : '5rem' }}
                />
              </Stack>
            ))}
            <HStack gap={2} justify="end">
              <Skeleton className="h-9 w-20" />
              <Skeleton className="h-9 w-20" />
            </HStack>
          </Stack>
        </ContentArea>
      </div>
    </>
  );
}
