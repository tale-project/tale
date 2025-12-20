import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils/cn';

interface CardSkeletonProps {
  /** Whether to show an image placeholder at the top */
  showImage?: boolean;
  /** Height of the image placeholder */
  imageHeight?: string;
  /** Number of text lines to show */
  lines?: number;
  /** Whether to show action buttons at the bottom */
  showActions?: boolean;
  /** Additional class name */
  className?: string;
}

/**
 * A skeleton card component for loading states.
 *
 * ## Example:
 * ```tsx
 * <CardSkeleton showImage lines={3} showActions />
 * ```
 */
export function CardSkeleton({
  showImage = false,
  imageHeight = 'h-40',
  lines = 3,
  showActions = false,
  className,
}: CardSkeletonProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card p-4 space-y-4',
        className
      )}
    >
      {showImage && (
        <Skeleton className={cn('w-full rounded-lg', imageHeight)} />
      )}

      <div className="space-y-2">
        {/* Title */}
        <Skeleton className="h-5 w-3/4" />

        {/* Content lines */}
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton
            key={i}
            className={cn(
              'h-3',
              i === lines - 1 ? 'w-1/2' : 'w-full'
            )}
          />
        ))}
      </div>

      {showActions && (
        <div className="flex gap-2 pt-2">
          <Skeleton className="h-9 flex-1 rounded-md" />
          <Skeleton className="h-9 w-9 rounded-md" />
        </div>
      )}
    </div>
  );
}

interface CardGridSkeletonProps {
  /** Number of cards to show */
  count?: number;
  /** Number of columns (CSS grid) */
  columns?: 1 | 2 | 3 | 4;
  /** Props to pass to each CardSkeleton */
  cardProps?: Omit<CardSkeletonProps, 'className'>;
  /** Additional class name */
  className?: string;
}

/**
 * A grid of skeleton cards for loading states.
 *
 * ## Example:
 * ```tsx
 * <CardGridSkeleton count={6} columns={3} cardProps={{ showImage: true }} />
 * ```
 */
export function CardGridSkeleton({
  count = 6,
  columns = 3,
  cardProps,
  className,
}: CardGridSkeletonProps) {
  const gridCols = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
  };

  return (
    <div className={cn('grid gap-4', gridCols[columns], className)}>
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} {...cardProps} />
      ))}
    </div>
  );
}

