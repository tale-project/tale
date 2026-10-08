import { cn } from '@tale/ui/cn';
import { Stack } from '@tale/ui/layout';
import { SkeletonBox, SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import {
  THREAD_COLUMN_CLASS,
  THREAD_OWN_BUBBLE_SURFACE_CLASS,
  THREAD_OWN_BUBBLE_WIDTH_CLASS,
} from '@tale/ui/thread/layout';

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
      className="@container flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <Stack gap={3} className={cn(THREAD_COLUMN_CLASS, 'py-6', className)}>
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

/** The hover footer (time + edit) keeps its space even while a user's bubble
 * is masked. */
function UserMessageSkeleton({ width }: { width: string }) {
  return (
    <div className="flex min-w-0 flex-col items-end gap-1">
      <SkeletonBox asChild>
        <div
          className={cn(
            THREAD_OWN_BUBBLE_WIDTH_CLASS,
            THREAD_OWN_BUBBLE_SURFACE_CLASS,
            width,
          )}
        >
          <SkeletonText />
        </div>
      </SkeletonBox>
      <div className="h-7" />
    </div>
  );
}
