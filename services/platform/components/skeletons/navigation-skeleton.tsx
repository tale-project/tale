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
 * Navigation skeleton for loading states (vertical sidebar style).
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
        className,
      )}
    >
      {Array.from({ length: items }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'flex items-center gap-2 p-2 rounded-md',
            orientation === 'vertical' ? 'w-full' : 'flex-shrink-0',
          )}
        >
          {/* Icon placeholder */}
          <Skeleton className="h-5 w-5 rounded-md flex-shrink-0" />

          {/* Text placeholder - only show for wider navigations */}
          {orientation === 'horizontal' && <Skeleton className="h-4 w-16" />}
        </div>
      ))}
    </nav>
  );
}

interface TabNavigationSkeletonProps {
  /** Tab labels to show (for accurate sizing) */
  tabs?: string[];
  /** Additional class name */
  className?: string;
}

/**
 * Tab navigation skeleton for horizontal tab-style navigation.
 * Matches the exact styling of KnowledgeNavigation and SettingsNavigation.
 *
 * ## Example:
 * ```tsx
 * <TabNavigationSkeleton tabs={['Documents', 'Websites', 'Products']} />
 * ```
 */
export function TabNavigationSkeleton({
  tabs = ['Tab 1', 'Tab 2', 'Tab 3'],
  className,
}: TabNavigationSkeletonProps) {
  return (
    <nav
      className={cn(
        'bg-background sticky top-12 z-50 border-b border-border px-4 py-2 min-h-12 flex items-center gap-4',
        className,
      )}
    >
      {tabs.map((tab, i) => (
        <div key={i} className="py-1">
          <Skeleton
            className="h-4 rounded"
            style={{ width: `${tab.length * 8}px` }}
          />
        </div>
      ))}
    </nav>
  );
}
