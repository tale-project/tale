'use client';

import { useLocation } from '@tanstack/react-router';
import { type ReactNode } from 'react';

import { ErrorBoundaryBase } from '../core/error-boundary-base';
import { ErrorDisplayCompact } from '../displays/error-display-compact';

interface LayoutErrorBoundaryProps {
  /** Child components to wrap */
  children: ReactNode;
  /** Organization ID for support links */
  organizationId?: string;
}

function isConvexTransientError(error: Error): boolean {
  const msg = error.message || '';
  return (
    msg.includes('timed out') ||
    msg.includes('Function execution') ||
    msg.includes('overloaded')
  );
}

const MAX_RETRIES = 3;

/**
 * Error boundary for layout-level errors.
 *
 * Features:
 * - Compact error display
 * - Auto-resets on pathname change (resetKeys pattern)
 * - Auto-retries transient Convex errors (timeouts, overloaded) up to 3 times
 * - Organization context support
 * - Preserves layout navigation
 */
export function LayoutErrorBoundary({
  children,
  organizationId,
}: LayoutErrorBoundaryProps) {
  const location = useLocation();
  const pathname = location.pathname;

  return (
    <ErrorBoundaryBase
      organizationId={organizationId}
      resetKeys={[pathname]}
      maxRetries={MAX_RETRIES}
      isRetryableError={isConvexTransientError}
      fallback={({ error, reset, organizationId }) => (
        <ErrorDisplayCompact
          error={error}
          organizationId={organizationId}
          reset={reset}
        />
      )}
    >
      {children}
    </ErrorBoundaryBase>
  );
}
