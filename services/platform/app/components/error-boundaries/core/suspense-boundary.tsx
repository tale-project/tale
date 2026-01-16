'use client';

import { Suspense, type ReactNode } from 'react';
import { ErrorBoundaryBase } from './error-boundary-base';

interface SuspenseBoundaryProps {
  /** Child components to wrap */
  children: ReactNode;
  /** Fallback content during loading (e.g., skeleton) */
  fallback: ReactNode;
  /** Fallback content on error */
  errorFallback?: ReactNode;
}

/**
 * Combines Suspense with error boundary for lazy-loaded components.
 *
 * Features:
 * - Handles both loading and error states
 * - Used with lazy-loaded imports
 * - Graceful fallback for failed imports
 * - No error logging for import failures (too noisy)
 *
 * Used with:
 * - DatePickerWithRange (lazy import in DataTableFilters)
 * - DocumentPreview
 * - ApprovalDetailDialog
 * - JSON viewers
 * - Any other lazy-loaded components
 *
 * @example
 * // In data-table-filters.tsx
 * const DatePickerWithRange = lazyComponent(() => import('...'));
 *
 * <SuspenseBoundary
 *   fallback={<Skeleton className="h-9 w-[24rem]" />}
 *   errorFallback={<span className="text-sm text-muted-foreground">Date filter unavailable</span>}
 * >
 *   <DatePickerWithRange {...props} />
 * </SuspenseBoundary>
 *
 * @example
 * // Simple usage with default error fallback
 * <SuspenseBoundary fallback={<LoadingSpinner />}>
 *   <LazyComponent />
 * </SuspenseBoundary>
 */
export function SuspenseBoundary({
  children,
  fallback,
  errorFallback = null,
}: SuspenseBoundaryProps) {
  return (
    <ErrorBoundaryBase
      fallback={() => errorFallback}
      // Don't log lazy import errors (expected failure mode)
      onError={() => {
        // Silently catch error - fallback shown
      }}
    >
      <Suspense fallback={fallback}>{children}</Suspense>
    </ErrorBoundaryBase>
  );
}
