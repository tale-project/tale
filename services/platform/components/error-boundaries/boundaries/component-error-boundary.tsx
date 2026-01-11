'use client';

import { type ReactNode } from 'react';
import { ErrorBoundaryBase } from '../core/error-boundary-base';
import { ErrorDisplayCompact } from '../displays/error-display-compact';
import { ErrorDisplayInline } from '../displays/error-display-inline';
import type { ErrorBoundarySize } from '../core/types';

interface ComponentErrorBoundaryProps {
  /** Child components to wrap */
  children: ReactNode;
  /** Organization ID for support links */
  organizationId?: string;
  /** Size variant for error display */
  size?: Extract<ErrorBoundarySize, 'compact' | 'inline'>;
  /** Callback when error occurs */
  onError?: (error: Error) => void;
  /** Callback when boundary resets */
  onReset?: () => void;
}

/**
 * Error boundary for complex components like integrations, workflow builders, etc.
 *
 * Features:
 * - Flexible size (compact or inline)
 * - Custom reset logic (close dialog, clear form, etc.)
 * - Optional error callback to parent
 * - Organization context support
 *
 * Used in:
 * - Integration dialogs (Shopify, Gmail, etc.)
 * - Workflow builders and editors
 * - Approval cards
 * - Complex forms
 *
 * @example
 * // Compact display for integration dialog
 * <ComponentErrorBoundary
 *   organizationId={organizationId}
 *   size="compact"
 *   onReset={() => setDialogOpen(false)}
 * >
 *   <ShopifyIntegrationDialog />
 * </ComponentErrorBoundary>
 *
 * @example
 * // Inline display for smaller component
 * <ComponentErrorBoundary size="inline">
 *   <StatusWidget />
 * </ComponentErrorBoundary>
 */
export function ComponentErrorBoundary({
  children,
  organizationId,
  size = 'compact',
  onError,
  onReset,
}: ComponentErrorBoundaryProps) {
  return (
    <ErrorBoundaryBase
      organizationId={organizationId}
      onError={(error, errorInfo) => {
        // Call custom error handler if provided
        onError?.(error);
      }}
      onReset={onReset}
      fallback={({ error, reset, organizationId }) => {
        if (size === 'inline') {
          return (
            <ErrorDisplayInline
              error={error}
              organizationId={organizationId}
              reset={reset}
            />
          );
        }

        return (
          <ErrorDisplayCompact
            error={error}
            organizationId={organizationId}
            reset={reset}
          />
        );
      }}
    >
      {children}
    </ErrorBoundaryBase>
  );
}
