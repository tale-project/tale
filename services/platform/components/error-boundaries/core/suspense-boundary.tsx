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
 * Combines Suspense with error boundary for dynamic imports and async components.
 *
 * Features:
 * - Handles both loading and error states
 * - Used with dynamic() imports
 * - Graceful fallback for failed imports
 * - No error logging for import failures (too noisy)
 *
 * Used with:
 * - DatePickerWithRange (dynamic import in DataTableFilters)
 * - DocumentPreview
 * - ApprovalDetailDialog
 * - JSON viewers
 * - Any other dynamically imported components
 *
 * @example
 * // In data-table-filters.tsx
 * const DatePickerWithRange = dynamic(() => import('...'));
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
 *   <DynamicComponent />
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
      // Don't log dynamic import errors (expected failure mode)
      onError={() => {
        // Silently catch error - fallback shown
      }}
    >
      <Suspense fallback={fallback}>{children}</Suspense>
    </ErrorBoundaryBase>
  );
}
