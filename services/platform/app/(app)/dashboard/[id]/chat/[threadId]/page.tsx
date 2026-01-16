import { Suspense } from 'react';
import { ChatInterface } from '../components/chat-interface';
import { Skeleton } from '@/components/ui/feedback/skeleton';
import { getT } from '@/lib/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('metadata');
  return {
    title: t('chat.title'),
    description: t('chat.description'),
  };
}

interface AIConversationPageProps {
  params: Promise<{ id: string; threadId: string }>;
}

/**
 * Skeleton for the chat input matching the actual ChatInput component layout.
 */
function ChatInputSkeleton() {
  return (
    <div className="max-w-[var(--chat-max-width)] mx-auto w-full sticky bottom-0 z-50">
      <div className="border-muted rounded-t-3xl border-[0.5rem] border-b-0 mx-2">
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
 * Skeleton for chat thread page with messages.
 * Matches the actual layout with message bubbles.
 */
function ChatSkeleton() {
  return (
    <div className="relative flex flex-col h-full flex-1 min-h-0">
      <div className="flex flex-col h-full flex-1 min-h-0 overflow-y-auto">
        {/* Messages area with conversation skeleton */}
        <div className="flex-1 overflow-y-visible p-4 sm:p-8">
          <div className="max-w-(--chat-max-width) mx-auto space-y-4">
            {/* User message */}
            <div className="flex justify-end">
              <div className="max-w-[80%]">
                <Skeleton className="h-12 w-64 rounded-2xl" />
              </div>
            </div>
            {/* Assistant message */}
            <div className="flex justify-start">
              <div className="max-w-[80%] space-y-2">
                <Skeleton className="h-4 w-full max-w-md" />
                <Skeleton className="h-4 w-5/6 max-w-md" />
                <Skeleton className="h-4 w-3/4 max-w-md" />
              </div>
            </div>
            {/* User message */}
            <div className="flex justify-end">
              <div className="max-w-[80%]">
                <Skeleton className="h-9 w-48 rounded-2xl" />
              </div>
            </div>
            {/* Assistant message */}
            <div className="flex justify-start">
              <div className="max-w-[80%] space-y-2">
                <Skeleton className="h-4 w-full max-w-lg" />
                <Skeleton className="h-4 w-4/5 max-w-lg" />
              </div>
            </div>
          </div>
        </div>
        {/* Chat input skeleton */}
        <ChatInputSkeleton />
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
    <Suspense fallback={<ChatSkeleton />}>
      <ChatContent params={params} />
    </Suspense>
  );
}
