import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils/cn';

interface NavigationSkeletonProps {
  /** Number of navigation items to show */
  items?: number;
  /** Orientation of the navigation */
  orientation?: 'horizontal' | 'vertical';
  /** Additional class name */
  className?: string;
}

/**
 * Navigation skeleton for loading states.
 *
 * ## Example:
 * ```tsx
 * <NavigationSkeleton items={5} orientation="vertical" />
 * ```
 */
export function NavigationSkeleton({
  items = 5,
  orientation = 'vertical',
  className,
}: NavigationSkeletonProps) {
  return (
    <nav
      className={cn(
        'flex gap-1',
        orientation === 'vertical' ? 'flex-col py-2' : 'flex-row px-2',
        className
      )}
    >
      {Array.from({ length: items }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'flex items-center gap-2 p-2 rounded-md',
            orientation === 'vertical' ? 'w-full' : 'flex-shrink-0'
          )}
        >
          {/* Icon placeholder */}
          <Skeleton className="h-5 w-5 rounded-md flex-shrink-0" />

          {/* Text placeholder - only show for wider navigations */}
          {orientation === 'horizontal' && (
            <Skeleton className="h-4 w-16" />
          )}
        </div>
      ))}
    </nav>
  );
}

