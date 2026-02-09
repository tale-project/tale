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

/**
 * Error boundary for layout-level errors.
 *
 * Features:
 * - Compact error display
 * - Auto-resets on pathname change (resetKeys pattern)
 * - Organization context support
 * - Preserves layout navigation
 *
 * Used in layout files to catch errors in child routes without crashing
 * the entire app.
 *
 * @example
 * // In app/(app)/dashboard/[id]/settings/layout.tsx
 * export default function SettingsLayout({ children }) {
 *   const organizationId = useParams().id as string;
 *
 *   return (
 *     <LayoutErrorBoundary organizationId={organizationId}>
 *       {children}
 *     </LayoutErrorBoundary>
 *   );
 * }
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
      resetKeys={[pathname]} // Auto-reset when route changes
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
