'use client';

import { useCallback } from 'react';

interface ErrorLogContext {
  organizationId?: string;
  pathname?: string;
  componentName?: string;
  [key: string]: unknown;
}

/**
 * Hook for logging errors to the console with rich context.
 *
 * Provides consistent error logging across all error boundaries.
 * Currently logs to console only, but can be extended for monitoring services.
 *
 * @example
 * const logError = useErrorLogger();
 * logError(error, { organizationId, pathname, componentName: 'DataTable' });
 */
export function useErrorLogger() {
  return useCallback((error: Error, context?: ErrorLogContext) => {
    console.error('Error caught by boundary:', {
      message: error.message,
      name: error.name,
      stack: error.stack,
      ...context,
      timestamp: new Date().toISOString(),
    });
  }, []);
}
