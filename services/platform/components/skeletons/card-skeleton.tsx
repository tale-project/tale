import { Skeleton } from '@/components/ui/feedback/skeleton';
import { Stack, HStack, Grid } from '@/components/ui/layout/layout';
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
    <Stack
      gap={4}
      className={cn(
        'rounded-xl border border-border bg-card p-4',
        className
      )}
    >
      {showImage && (
        <Skeleton className={cn('w-full rounded-lg', imageHeight)} />
      )}

      <Stack gap={2}>
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
      </Stack>

      {showActions && (
        <HStack gap={2} className="pt-2">
          <Skeleton className="h-9 flex-1 rounded-md" />
          <Skeleton className="h-9 w-9 rounded-md" />
        </HStack>
      )}
    </Stack>
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
  const colsMap: Record<number, 1 | 2 | 3 | 4> = { 1: 1, 2: 2, 3: 3, 4: 4 };
  const smMap: Record<number, 1 | 2 | undefined> = { 1: undefined, 2: 2, 3: 2, 4: 2 };
  const lgMap: Record<number, 1 | 2 | 3 | undefined> = { 1: undefined, 2: undefined, 3: 3, 4: 3 };
  const xlMap: Record<number, 1 | 2 | 3 | 4 | undefined> = { 1: undefined, 2: undefined, 3: undefined, 4: 4 };

  return (
    <Grid
      cols={colsMap[columns]}
      sm={smMap[columns]}
      lg={lgMap[columns]}
      xl={xlMap[columns]}
      gap={4}
      className={className}
    >
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} {...cardProps} />
      ))}
    </Grid>
  );
}

