import { createFileRoute } from '@tanstack/react-router';
import { Suspense } from 'react';
import { ChatInterface } from '@/app/features/chat/components/chat-interface';
import { ChatLayoutProvider } from '@/app/features/chat/context/chat-layout-context';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';

export const Route = createFileRoute('/dashboard/$id/chat')({
  component: ChatPage,
});

function ChatInputSkeleton() {
  return (
    <div className="max-w-[var(--chat-max-width)] mx-auto w-full sticky bottom-0 z-50">
      <div className="border-muted rounded-t-3xl border-[0.5rem] border-b-0 mx-2">
        <div className="flex relative flex-col gap-2 bg-background rounded-t-2xl pt-3 px-4 border border-muted-foreground/50 border-b-0">
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
    <div className="relative flex flex-col h-full flex-1 min-h-0">
      <div className="flex flex-col h-full flex-1 min-h-0 overflow-y-auto">
        <div className="flex-1 overflow-y-visible p-4 sm:p-8 flex flex-col items-center justify-end">
          <div className="flex-1 flex items-center justify-center size-full">
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
    <ChatLayoutProvider>
      <Suspense fallback={<ChatSkeleton />}>
        <ChatInterface organizationId={organizationId} />
      </Suspense>
    </ChatLayoutProvider>
  );
}
