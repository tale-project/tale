import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils/cn';

interface ListItemSkeletonProps {
  /** Whether to show an avatar/icon on the left */
  showAvatar?: boolean;
  /** Whether to show a secondary line of text */
  showSecondary?: boolean;
  /** Whether to show an action on the right */
  showAction?: boolean;
  /** Additional class name */
  className?: string;
}

/**
 * A single list item skeleton.
 */
export function ListItemSkeleton({
  showAvatar = true,
  showSecondary = true,
  showAction = false,
  className,
}: ListItemSkeletonProps) {
  return (
    <div className={cn('flex items-center gap-3 p-3 rounded-lg', className)}>
      {showAvatar && (
        <Skeleton className="h-9 w-10 rounded-full flex-shrink-0" />
      )}

      <div className="flex-1 min-w-0 space-y-1">
        <Skeleton className="h-4 w-3/4" />
        {showSecondary && <Skeleton className="h-3 w-1/2" />}
      </div>

      {showAction && <Skeleton className="h-8 w-8 rounded-md flex-shrink-0" />}
    </div>
  );
}

interface ListSkeletonProps {
  /** Number of items to show */
  items?: number;
  /** Props to pass to each ListItemSkeleton */
  itemProps?: Omit<ListItemSkeletonProps, 'className'>;
  /** Whether to show dividers between items */
  showDividers?: boolean;
  /** Additional class name */
  className?: string;
}

/**
 * List skeleton for loading states.
 *
 * ## Example:
 * ```tsx
 * <ListSkeleton items={5} itemProps={{ showAvatar: true, showAction: true }} />
 * ```
 */
export function ListSkeleton({
  items = 5,
  itemProps,
  showDividers = false,
  className,
}: ListSkeletonProps) {
  return (
    <div className={cn('space-y-1', className)}>
      {Array.from({ length: items }).map((_, i) => (
        <div key={i}>
          <ListItemSkeleton {...itemProps} />
          {showDividers && i < items - 1 && (
            <div className="border-b border-border mx-3" />
          )}
        </div>
      ))}
    </div>
  );
}
