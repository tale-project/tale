'use client';

import { type ReactNode } from 'react';
import { ErrorBoundaryBase } from '../core/error-boundary-base';

interface CellErrorBoundaryProps {
  /** Child components to wrap */
  children: ReactNode;
  /** Fallback content to show on error (e.g., "—" or error icon) */
  fallback?: ReactNode;
}

/**
 * Error boundary for complex table cell renderers.
 *
 * Features:
 * - Inline error display (doesn't break table layout)
 * - Custom fallback content
 * - No error logging (too noisy for cell-level errors)
 * - Minimal visual disruption
 *
 * Used in:
 * - Table cells with complex logic
 * - Cells doing metadata parsing (e.g., renderProductList in approvals)
 * - Cells with dynamic rendering
 * - Image cells with complex transformations
 *
 * @example
 * // In table column definitions
 * {
 *   accessorKey: 'products',
 *   cell: ({ row }) => (
 *     <CellErrorBoundary fallback={<span className="text-muted-foreground">—</span>}>
 *       <ComplexProductList products={row.original.metadata.products} />
 *     </CellErrorBoundary>
 *   ),
 * }
 *
 * @example
 * // With icon fallback
 * <CellErrorBoundary fallback={<AlertCircle className="size-4 text-red-500" />}>
 *   <StatusIndicator status={complexStatus} />
 * </CellErrorBoundary>
 */
export function CellErrorBoundary({
  children,
  fallback = <span className="text-muted-foreground">—</span>,
}: CellErrorBoundaryProps) {
  return (
    <ErrorBoundaryBase
      fallback={() => fallback}
      // Don't log cell-level errors to avoid console noise
      onError={() => {
        // Silently catch error - table continues rendering
      }}
    >
      {children}
    </ErrorBoundaryBase>
  );
}
