import { Suspense } from 'react';
import ChatInterface from './components/chat-interface';
import { Skeleton } from '@/components/ui/skeleton';

interface ChatPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Skeleton for the chat input matching the actual ChatInput component layout.
 */
function ChatInputSkeleton() {
  return (
    <div className="max-w-[var(--chat-max-width)] mx-auto w-full sticky bottom-0 z-50">
      <div className="border-muted rounded-t-3xl border-[0.5rem] border-b-0">
        <div className="flex relative flex-col gap-2 bg-background rounded-t-2xl pt-3 px-4 border border-muted-foreground/50 border-b-0">
          {/* Textarea placeholder */}
          <Skeleton className="h-[100px] w-full bg-transparent" />
          {/* Action buttons row */}
          <div className="flex items-center pb-3">
            <Skeleton className="h-5 w-5 rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Skeleton for new chat page - shows welcome message placeholder.
 * Matches the actual layout without messages.
 */
function ChatSkeleton() {
  return (
    <div className="relative flex flex-col h-full flex-1 min-h-0">
      <div className="flex flex-col h-full flex-1 min-h-0 overflow-y-auto">
        {/* Messages area - empty state with centered title skeleton */}
        <div className="flex-1 overflow-y-visible p-8 flex flex-col items-center justify-end">
          <div className="flex-1 flex items-center justify-center size-full">
            <Skeleton className="h-10 w-80" />
          </div>
        </div>
        {/* Chat input skeleton */}
        <ChatInputSkeleton />
      </div>
    </div>
  );
}

interface ChatContentProps {
  params: Promise<{ id: string }>;
}

async function ChatContent({ params }: ChatContentProps) {
  // All dynamic data access inside Suspense boundary for proper streaming
  const { id: organizationId } = await params;
  // Render chat interface without threadId - thread will be created on first message
  return <ChatInterface organizationId={organizationId} />;
}

export default function ChatPage({ params }: ChatPageProps) {
  return (
    <Suspense fallback={<ChatSkeleton />}>
      <ChatContent params={params} />
    </Suspense>
  );
}
