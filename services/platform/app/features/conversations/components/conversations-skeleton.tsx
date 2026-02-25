import { PanelFooter } from '@/app/components/layout/panel-footer';
import { PanelHeader } from '@/app/components/layout/panel-header';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { HStack, VStack } from '@/app/components/ui/layout/layout';

interface ConversationsListSkeletonProps {
  rows?: number;
}

export function ConversationsListSkeleton({
  rows = 3,
}: ConversationsListSkeletonProps) {
  return (
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
              <HStack gap={2} justify="between" className="mb-3">
                <Skeleton className="h-4 w-full" />
              </HStack>
              <div className="flex gap-2">
                {i % 3 === 0 && <Skeleton className="h-5 w-16 rounded-full" />}
                {i % 2 === 0 && <Skeleton className="h-5 w-20 rounded-full" />}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ConversationPanelSkeleton() {
  return (
    <VStack className="min-w-0 flex-1">
      <PanelHeader>
        <HStack gap={3} className="flex-1">
          <Skeleton className="size-10 rounded-full" />
          <VStack className="flex-1 gap-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </VStack>
        </HStack>
      </PanelHeader>

      <div className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6">
        <VStack gap={4} className="mb-8">
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
        </VStack>
      </div>

      <PanelFooter className="px-2">
        <div className="mx-auto w-full max-w-3xl px-4 py-4">
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      </PanelFooter>
    </VStack>
  );
}
