import { HStack, VStack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';

import { PanelFooter } from '@/app/components/layout/panel-footer';
import { cn } from '@/lib/utils/cn';

/**
 * Skeleton row matching `ConversationRow` (conversations-list.tsx) EXACTLY:
 * `px-4 py-2.5`, `gap-2.5`, a `size-4` checkbox at `mt-0.5`, then the
 * heading (`mb-1`), title (`mb-1.5`), preview (`mb-2`), and badge row. Kept in
 * lockstep with the real row so the skeleton→data swap doesn't shift the list.
 */
function ConversationRowSkeleton({ index }: { index: number }) {
  return (
    <div className="px-4 py-2.5">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex items-center">
          <SkeletonBox className="size-4 rounded" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center justify-between gap-2">
            <SkeletonBox className="h-4 w-2/5" />
            <SkeletonBox className="h-3 w-12" />
          </div>
          <SkeletonBox className="mb-1.5 h-4 w-3/4" />
          <SkeletonBox className="mb-2 h-3.5 w-full" />
          <HStack gap={2}>
            {index % 3 === 0 && (
              <SkeletonBox className="h-5 w-16 rounded-full" />
            )}
            {index % 2 === 0 && (
              <SkeletonBox className="h-5 w-20 rounded-full" />
            )}
          </HStack>
        </div>
      </div>
    </div>
  );
}

interface ConversationsListSkeletonProps {
  rows?: number;
}

/**
 * The single source of truth for the conversation-list loading state. Rendered
 * by `Conversations` (list-load) and by `ConversationsList` (cold first paint).
 * `divide-y border-b` and the per-row layout mirror the loaded list so rows
 * don't jump when data arrives.
 */
export function ConversationsListSkeleton({
  rows = 12,
}: ConversationsListSkeletonProps) {
  return (
    <div className="divide-border divide-y border-b" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <ConversationRowSkeleton key={i} index={i} />
      ))}
    </div>
  );
}

/**
 * Skeleton for `ConversationHeader`. Mirrors the real header's wrapper
 * (`flex flex-col gap-3 border-b p-4 sm:px-6 sm:py-4`), subject row (text +
 * `size-7` action button) and sender row (`size-8` avatar + name/email),
 * so swapping the real header in doesn't shift the messages below it.
 */
function ConversationHeaderSkeleton() {
  return (
    <div
      className="border-border flex flex-col gap-3 border-b p-4 sm:px-6 sm:py-4"
      aria-hidden="true"
    >
      <div className="flex items-center justify-between gap-4">
        <SkeletonBox className="h-5 w-64 max-w-full" />
        <SkeletonBox className="size-7 shrink-0 rounded-md" />
      </div>
      <div className="flex items-center gap-2.5">
        <SkeletonBox className="size-8 shrink-0 rounded-full" />
        <VStack className="gap-1">
          <SkeletonBox className="h-3.5 w-28" />
          <SkeletonBox className="h-3 w-44" />
        </VStack>
      </div>
    </div>
  );
}

/** One placeholder message bubble + timestamp, sized like a real `Message`. */
function MessageBubbleSkeleton({
  align,
  bubbleClassName,
  withTimestamp,
}: {
  align: 'start' | 'end';
  bubbleClassName: string;
  withTimestamp?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex',
        align === 'start' ? 'justify-start' : 'justify-end',
      )}
    >
      <div className="relative">
        <SkeletonBox className={cn('mb-2 rounded-2xl', bubbleClassName)} />
        {withTimestamp && <SkeletonBox className="h-3 w-20" />}
      </div>
    </div>
  );
}

interface ConversationPanelSkeletonProps {
  status?: 'open' | 'closed' | 'archived' | 'spam';
}

/**
 * The single source of truth for the conversation-panel loading state. Its
 * outer wrapper, header, message-area padding (`px-4 pt-2`) and footer mirror
 * the loaded `ConversationPanel` EXACTLY so there is no horizontal/vertical
 * shift when the conversation resolves. The composer placeholder height
 * (`h-[5rem]`) matches `MessageEditor`'s default collapsed height.
 */
export function ConversationPanelSkeleton({
  status,
}: ConversationPanelSkeletonProps) {
  const isInactive =
    status === 'closed' || status === 'archived' || status === 'spam';

  return (
    <div className="relative flex flex-[1_1_0] flex-col overflow-y-auto">
      <div className="bg-background sticky top-0 z-20">
        <ConversationHeaderSkeleton />
      </div>

      <div
        className="mx-auto w-full max-w-3xl flex-1 px-4 pt-2"
        aria-hidden="true"
      >
        {/* Date pill — mirrors the real centered date header (`mb-4 py-2`). */}
        <div className="mb-4 py-2">
          <div className="flex justify-center">
            <SkeletonBox className="h-5 w-24 rounded-full" />
          </div>
        </div>
        <VStack gap={4} className="mb-8">
          <MessageBubbleSkeleton
            align="start"
            bubbleClassName="h-24 w-96 max-w-full"
            withTimestamp
          />
          <MessageBubbleSkeleton
            align="end"
            bubbleClassName="h-20 w-80 max-w-full"
          />
          <MessageBubbleSkeleton
            align="start"
            bubbleClassName="h-16 w-72 max-w-full"
            withTimestamp
          />
        </VStack>
      </div>

      {isInactive ? (
        // Matches the loaded panel's inactive footer (`py-3 px-0 pb-0`).
        <PanelFooter className="px-0 pt-3 pb-0">
          <div
            className="flex items-center justify-center gap-2 border-t px-3 pt-3 pb-4"
            aria-hidden="true"
          >
            <SkeletonBox className="h-4 w-48" />
            <SkeletonBox className="h-7 w-32 rounded-md" />
          </div>
        </PanelFooter>
      ) : (
        <PanelFooter className="px-4 py-3">
          <div className="mx-auto w-full max-w-3xl" aria-hidden="true">
            <SkeletonBox className="h-[5rem] w-full rounded-xl" />
          </div>
        </PanelFooter>
      )}
    </div>
  );
}
