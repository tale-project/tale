import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils/cn';

interface PageHeaderSkeletonProps {
  /** Whether to show breadcrumbs */
  showBreadcrumbs?: boolean;
  /** Whether to show action buttons */
  showActions?: boolean;
  /** Number of action button placeholders */
  actionCount?: number;
  /** Additional class name */
  className?: string;
}

/**
 * Page header skeleton for loading states.
 * Matches the common header pattern used across dashboard pages.
 *
 * ## Example:
 * ```tsx
 * <PageHeaderSkeleton showBreadcrumbs showActions actionCount={2} />
 * ```
 */
export function PageHeaderSkeleton({
  showBreadcrumbs = false,
  showActions = false,
  actionCount = 1,
  className,
}: PageHeaderSkeletonProps) {
  return (
    <div
      className={cn(
        'px-4 py-2 sticky top-0 z-10 bg-background/50 backdrop-blur-md min-h-12 flex flex-col gap-2',
        className
      )}
    >
      {showBreadcrumbs && (
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-16" />
          <span className="text-muted-foreground">/</span>
          <Skeleton className="h-3 w-24" />
        </div>
      )}

      <div className="flex items-center justify-between">
        {/* Title */}
        <Skeleton className="h-6 w-32" />

        {/* Actions */}
        {showActions && (
          <div className="flex items-center gap-2">
            {Array.from({ length: actionCount }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-24 rounded-md" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

