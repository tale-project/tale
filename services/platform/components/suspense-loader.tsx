import { Suspense, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

interface SuspenseLoaderProps {
  children: ReactNode;
  /**
   * Custom fallback to show while loading.
   * If not provided, shows a centered spinner.
   *
   * For better UX, prefer using domain-specific skeletons:
   * @example
   * ```tsx
   * import { TableSkeleton } from '@/components/skeletons';
   *
   * <SuspenseLoader fallback={<TableSkeleton rows={10} />}>
   *   <CustomersTable />
   * </SuspenseLoader>
   * ```
   */
  fallback?: ReactNode;
}

/**
 * Default loading fallback - a centered spinner.
 * Prefer using domain-specific skeletons for better UX.
 */
function DefaultFallback() {
  return (
    <div className="flex items-center justify-center min-h-[200px] p-8">
      <Loader2 className="size-8 animate-spin text-muted-foreground" />
    </div>
  );
}

/**
 * SuspenseLoader - Wrapper for async content with loading states.
 *
 * ## Usage:
 *
 * Basic usage with default spinner:
 * ```tsx
 * <SuspenseLoader>
 *   <AsyncContent />
 * </SuspenseLoader>
 * ```
 *
 * With custom skeleton for better UX:
 * ```tsx
 * import { TableSkeleton } from '@/components/skeletons';
 *
 * <SuspenseLoader fallback={<TableSkeleton rows={10} />}>
 *   <CustomersTable />
 * </SuspenseLoader>
 * ```
 *
 * ## Performance Benefits:
 * - Enables streaming: content loads progressively
 * - Prevents blocking: other parts of the page render immediately
 * - Better perceived performance with skeletons vs spinners
 *
 * @see AsyncBoundary for combined Suspense + ErrorBoundary
 */
export function SuspenseLoader({ children, fallback }: SuspenseLoaderProps) {
  return (
    <Suspense fallback={fallback ?? <DefaultFallback />}>{children}</Suspense>
  );
}
