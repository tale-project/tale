import { createFileRoute } from '@tanstack/react-router';
import { Suspense } from 'react';

import { LayoutErrorBoundary } from '@/app/components/error-boundaries/boundaries/layout-error-boundary';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { ChatInterface } from '@/app/features/chat/components/chat-interface';

export const Route = createFileRoute('/dashboard/$id/chat/$threadId')({
  component: ChatThreadPage,
});

function ChatInputSkeleton() {
  return (
    <div className="sticky bottom-0 z-50 mx-auto w-full max-w-(--chat-max-width)">
      <div className="border-muted mx-2 rounded-t-3xl border-[0.5rem] border-b-0">
        <div className="bg-background border-muted-foreground/50 relative flex flex-col gap-2 rounded-t-2xl border border-b-0 px-4 pt-3">
          <Skeleton className="h-[100px] w-full bg-transparent" />
          <div className="flex items-center pb-3">
            <Skeleton className="h-5 w-5 rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatSkeleton() {
  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col">
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex-1 overflow-y-visible p-4 sm:p-8">
          <div className="mx-auto max-w-(--chat-max-width) space-y-4">
            <div className="flex justify-end">
              <div className="max-w-[80%]">
                <Skeleton className="h-12 w-64 rounded-2xl" />
              </div>
            </div>
            <div className="flex justify-start">
              <div className="max-w-[80%] space-y-2">
                <Skeleton className="h-4 w-full max-w-md" />
                <Skeleton className="h-4 w-5/6 max-w-md" />
                <Skeleton className="h-4 w-3/4 max-w-md" />
              </div>
            </div>
            <div className="flex justify-end">
              <div className="max-w-[80%]">
                <Skeleton className="h-9 w-48 rounded-2xl" />
              </div>
            </div>
            <div className="flex justify-start">
              <div className="max-w-[80%] space-y-2">
                <Skeleton className="h-4 w-full max-w-lg" />
                <Skeleton className="h-4 w-4/5 max-w-lg" />
              </div>
            </div>
          </div>
        </div>
        <ChatInputSkeleton />
      </div>
    </div>
  );
}

function ChatThreadPage() {
  const { id: organizationId, threadId } = Route.useParams();

  return (
    <LayoutErrorBoundary organizationId={organizationId}>
      <Suspense fallback={<ChatSkeleton />}>
        <ChatInterface organizationId={organizationId} threadId={threadId} />
      </Suspense>
    </LayoutErrorBoundary>
  );
}
