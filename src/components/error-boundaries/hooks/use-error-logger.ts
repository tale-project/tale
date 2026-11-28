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
 * Provides consistent error logging across all error boundaries. The Error
 * itself is passed, not a copy of its fields: a console-promoting monitor
 * (the platform's Sentry `captureConsoleIntegration`) reports an Error
 * argument as an exception with its type and stack, and the context rides
 * along as the call's extra arguments. A plain object would reach it as the
 * text `[object Object]`.
 *
 * @example
 * const logError = useErrorLogger();
 * logError(error, { organizationId, pathname, componentName: 'DataTable' });
 */
export function useErrorLogger() {
  return useCallback((error: Error, context?: ErrorLogContext) => {
    console.error('Error caught by boundary:', error, context);
  }, []);
}
