'use client';

import { useCallback } from 'react';

interface UseErrorResetOptions {
  /** Custom reset logic to execute */
  onReset?: () => void;
  /** Function to clear local state */
  clearState?: () => void;
}

/**
 * Hook for handling error boundary resets without using router.refresh().
 *
 * Provides a reset function that can:
 * - Clear local component state
 * - Trigger custom reset logic
 * - Invalidate queries
 *
 * @example
 * const reset = useErrorReset({
 *   onReset: () => refetchData(),
 *   clearState: () => setLocalState(initialState)
 * });
 */
export function useErrorReset(options?: UseErrorResetOptions) {
  return useCallback(() => {
    // Clear local state if provided
    options?.clearState?.();

    // Trigger custom reset logic
    options?.onReset?.();
  }, [options]);
}
