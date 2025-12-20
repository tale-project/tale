import ChatInterface from '../components/chat-interface';
import { SuspenseLoader } from '@/components/suspense-loader';
import { Skeleton } from '@/components/ui/skeleton';

interface AIConversationPageProps {
  params: Promise<{ id: string; threadId: string }>;
}

/**
 * Skeleton for the chat interface that matches the actual layout.
 */
function ChatSkeleton() {
  return (
    <div className="flex flex-col h-full">
      {/* Chat header skeleton */}
      <div className="flex items-center justify-between p-4 border-b">
        <Skeleton className="h-6 w-48 rounded-md" />
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>

      {/* Chat messages area skeleton */}
      <div className="flex-1 p-4 space-y-4">
        {/* Assistant message */}
        <div className="flex gap-3">
          <Skeleton className="h-8 w-8 rounded-full shrink-0" />
          <div className="space-y-2 flex-1 max-w-[80%]">
            <Skeleton className="h-4 w-full rounded-md" />
            <Skeleton className="h-4 w-3/4 rounded-md" />
          </div>
        </div>
        {/* User message */}
        <div className="flex gap-3 justify-end">
          <div className="space-y-2 max-w-[80%]">
            <Skeleton className="h-4 w-48 rounded-md" />
          </div>
          <Skeleton className="h-8 w-8 rounded-full shrink-0" />
        </div>
        {/* Assistant message */}
        <div className="flex gap-3">
          <Skeleton className="h-8 w-8 rounded-full shrink-0" />
          <div className="space-y-2 flex-1 max-w-[80%]">
            <Skeleton className="h-4 w-full rounded-md" />
            <Skeleton className="h-4 w-5/6 rounded-md" />
            <Skeleton className="h-4 w-2/3 rounded-md" />
          </div>
        </div>
      </div>

      {/* Chat input skeleton */}
      <div className="p-4 border-t">
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    </div>
  );
}

interface ChatContentProps {
  params: Promise<{ id: string; threadId: string }>;
}

async function ChatContent({ params }: ChatContentProps) {
  // All dynamic data access inside Suspense boundary for proper streaming
  const { id: organizationId, threadId } = await params;
  return <ChatInterface organizationId={organizationId} threadId={threadId} />;
}

export default function AIConversationPage({
  params,
}: AIConversationPageProps) {
  return (
    <SuspenseLoader fallback={<ChatSkeleton />}>
      <ChatContent params={params} />
    </SuspenseLoader>
  );
}
