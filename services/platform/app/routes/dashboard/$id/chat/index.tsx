import { createFileRoute } from '@tanstack/react-router';
import { Suspense } from 'react';

import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { ChatInterface } from '@/app/features/chat/components/chat-interface';

export const Route = createFileRoute('/dashboard/$id/chat/')({
  component: ChatPage,
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
        <div className="flex flex-1 flex-col items-center justify-end overflow-y-visible p-4 sm:p-8">
          <div className="flex size-full flex-1 items-center justify-center">
            <Skeleton className="h-9 w-80" />
          </div>
        </div>
        <ChatInputSkeleton />
      </div>
    </div>
  );
}

function ChatPage() {
  const { id: organizationId } = Route.useParams();

  return (
    <Suspense fallback={<ChatSkeleton />}>
      <ChatInterface organizationId={organizationId} />
    </Suspense>
  );
}
