import { Stack } from '@tale/ui/layout';
import { SkeletonBox, SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';

import { cn } from '@/lib/utils/cn';

import {
  CHAT_MESSAGE_COLUMN_CLASS,
  CHAT_USER_BUBBLE_CLASS,
  CHAT_USER_MESSAGE_CLASS,
} from '../lib/layout';

/**
 * Masked stand-in for an open conversation while its messages are on their
 * way — message-shaped, in place, per the design system's "skeletons mask in
 * place, never a bare spinner where a skeleton fits". Mirrors MessageThread's
 * geometry: right-aligned user bubbles, full-width assistant prose, and the
 * same column insets and message gap. The history's length and text widths
 * remain unknown until it arrives.
 */
export function ConversationSkeleton({
  label,
  className,
}: {
  /** Announced once for the region (`Skeletonize`'s status label). */
  label: string;
  className?: string;
}) {
  return (
    <Skeletonize
      loading
      label={label}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <Stack gap={3} className={cn(CHAT_MESSAGE_COLUMN_CLASS, className)}>
        <UserMessageSkeleton width="w-64" />
        <div className="w-full min-w-0 text-sm">
          <SkeletonText lines={3} />
          <div className="mt-1 h-7" />
        </div>
        <UserMessageSkeleton width="w-48" />
      </Stack>
    </Skeletonize>
  );
}

/** The hover actions keep their space even while a user's bubble is masked. */
function UserMessageSkeleton({ width }: { width: string }) {
  return (
    <div className="flex min-w-0 flex-col items-end">
      <div className={CHAT_USER_MESSAGE_CLASS}>
        <SkeletonBox asChild>
          <div
            className={cn(
              CHAT_USER_BUBBLE_CLASS,
              'max-w-full text-sm leading-relaxed',
              width,
            )}
          >
            <SkeletonText />
          </div>
        </SkeletonBox>
        <div className="mt-1 h-6" />
      </div>
    </div>
  );
}
