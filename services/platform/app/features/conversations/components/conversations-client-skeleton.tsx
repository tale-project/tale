import { Skeleton } from '@/app/components/ui/feedback/skeleton';

interface ConversationsClientSkeletonProps {
  rows?: number;
}

export function ConversationsClientSkeleton({
  rows = 8,
}: ConversationsClientSkeletonProps) {
  return (
    <>
      <div className="border-border relative flex w-full flex-col overflow-y-auto border-r md:max-w-[24.75rem] md:flex-[0_0_24.75rem]">
        <div className="bg-background/50 border-border sticky top-0 z-10 flex h-16 items-center gap-2.5 border-b p-4 backdrop-blur-sm">
          <div className="border-muted bg-background size-4 rounded border-2" />
          <div className="relative flex-1">
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        </div>

        <div className="divide-border divide-y">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="p-4">
              <div className="flex items-start gap-3">
                <div className="mt-1 flex items-center">
                  <div className="border-muted bg-background size-4 rounded border-2" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex items-start justify-between">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="ml-4 h-3 w-12" />
                  </div>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <Skeleton className="h-4 w-full" />
                  </div>
                  <div className="flex gap-2">
                    {i % 3 === 0 && (
                      <Skeleton className="h-5 w-16 rounded-full" />
                    )}
                    {i % 2 === 0 && (
                      <Skeleton className="h-5 w-20 rounded-full" />
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="hidden min-w-0 flex-1 flex-col md:flex">
        <div className="bg-background/50 border-border sticky top-0 z-50 flex h-16 flex-[0_0_auto] border-b px-4 py-3 backdrop-blur-sm">
          <div className="flex flex-1 items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        </div>

        <div className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6">
          <div className="mb-8 flex flex-col gap-4">
            <div className="flex justify-start">
              <div className="relative">
                <Skeleton className="h-24 w-96 rounded-2xl" />
                <Skeleton className="mt-1 h-3 w-20" />
              </div>
            </div>
            <div className="flex justify-end">
              <Skeleton className="h-20 w-80 rounded-2xl" />
            </div>
            <div className="flex justify-start">
              <div className="relative">
                <Skeleton className="h-16 w-72 rounded-2xl" />
                <Skeleton className="mt-1 h-3 w-20" />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-background sticky bottom-0 z-50 px-2">
          <div className="mx-auto w-full max-w-3xl px-4 py-4">
            <Skeleton className="h-32 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </>
  );
}
