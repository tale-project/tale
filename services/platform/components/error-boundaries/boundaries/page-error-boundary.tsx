'use client';

import type { ReactNode } from 'react';
import { ErrorDisplayFull } from '../displays/error-display-full';

interface PageErrorBoundaryProps {
  /** The error from Next.js error.tsx */
  error: Error & { digest?: string };
  /** Organization ID for support links */
  organizationId?: string;
  /** Optional custom header (e.g., logo, user button) */
  header?: ReactNode;
}

/**
 * Error boundary for Next.js error.tsx files (page-level errors).
 *
 * Features:
 * - Full-page error display
 * - Optional custom header
 * - Organization context support
 * - Integrates with Next.js error handling
 *
 * Usage in error.tsx files:
 * ```tsx
 * 'use client';
 *
 * import { PageErrorBoundary } from '@/components/error-boundaries';
 *
 * export default function Error({ error }: { error: Error & { digest?: string } }) {
 *   const organizationId = useParams().id as string;
 *
 *   return (
 *     <PageErrorBoundary
 *       error={error}
 *       organizationId={organizationId}
 *       header={<AppHeader />}
 *     />
 *   );
 * }
 * ```
 */
export function PageErrorBoundary({
  error,
  organizationId,
  header,
}: PageErrorBoundaryProps) {
  // For Next.js error.tsx, reset is handled by framework via navigation
  // We provide a no-op reset function since the page will remount on navigation
  const reset = () => {
    // Next.js handles reset via router navigation
    // User can navigate away or refresh to recover
  };

  return (
    <ErrorDisplayFull
      error={error}
      organizationId={organizationId}
      reset={reset}
      header={header}
    />
  );
}
