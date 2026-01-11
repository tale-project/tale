'use client';

import { useContext } from 'react';
import { ErrorBoundaryContext } from '../core/error-context';

/**
 * Hook to access error boundary context from nested components.
 *
 * Allows deeply nested components to:
 * - Check if they're within an error boundary
 * - Trigger manual resets
 * - Access error state and metadata
 *
 * @throws {Error} If used outside of an ErrorBoundary
 *
 * @example
 * const { hasError, error, reset, organizationId } = useErrorBoundaryContext();
 * if (hasError) {
 *   return <button onClick={reset}>Try Again</button>;
 * }
 */
export function useErrorBoundaryContext() {
  const context = useContext(ErrorBoundaryContext);

  if (!context) {
    throw new Error(
      'useErrorBoundaryContext must be used within an ErrorBoundary'
    );
  }

  return context;
}
