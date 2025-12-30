'use client';

import { useState, useCallback, useRef } from 'react';

export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

export interface AsyncState<T> {
  /** Current status of the async operation */
  status: AsyncStatus;
  /** Data from successful operation */
  data: T | null;
  /** Error from failed operation */
  error: Error | null;
  /** Whether the operation is currently loading */
  isLoading: boolean;
  /** Whether the operation completed successfully */
  isSuccess: boolean;
  /** Whether the operation failed */
  isError: boolean;
  /** Whether the operation is in idle state */
  isIdle: boolean;
}

export interface UseAsyncStateReturn<T, TArgs extends unknown[]> extends AsyncState<T> {
  /** Execute the async operation */
  execute: (...args: TArgs) => Promise<T>;
  /** Reset state to idle */
  reset: () => void;
  /** Set data directly */
  setData: (data: T | null) => void;
  /** Set error directly */
  setError: (error: Error | null) => void;
}

export interface UseAsyncStateOptions<T> {
  /** Initial data value */
  initialData?: T | null;
  /** Callback when operation succeeds */
  onSuccess?: (data: T) => void;
  /** Callback when operation fails */
  onError?: (error: Error) => void;
  /** Callback when operation completes (success or error) */
  onSettled?: () => void;
  /** Whether to reset error on new execution */
  resetErrorOnExecute?: boolean;
}

/**
 * Hook for managing async operation state.
 * Provides standardized loading, success, and error states.
 *
 * @example
 * ```tsx
 * const saveUser = useAsyncState(async (userData: UserData) => {
 *   return await api.saveUser(userData);
 * }, {
 *   onSuccess: () => toast({ title: 'User saved!' }),
 *   onError: (err) => toast({ title: err.message, variant: 'destructive' }),
 * });
 *
 * const handleSubmit = (data: UserData) => {
 *   saveUser.execute(data);
 * };
 *
 * return (
 *   <Button disabled={saveUser.isLoading}>
 *     {saveUser.isLoading ? 'Saving...' : 'Save'}
 *   </Button>
 * );
 * ```
 */
export function useAsyncState<T, TArgs extends unknown[] = []>(
  asyncFn: (...args: TArgs) => Promise<T>,
  options: UseAsyncStateOptions<T> = {}
): UseAsyncStateReturn<T, TArgs> {
  const {
    initialData = null,
    onSuccess,
    onError,
    onSettled,
    resetErrorOnExecute = true,
  } = options;

  const [status, setStatus] = useState<AsyncStatus>('idle');
  const [data, setData] = useState<T | null>(initialData);
  const [error, setError] = useState<Error | null>(null);

  // Keep track of the latest execution to prevent race conditions
  const executionIdRef = useRef(0);

  const execute = useCallback(
    async (...args: TArgs): Promise<T> => {
      const executionId = ++executionIdRef.current;

      setStatus('loading');
      if (resetErrorOnExecute) {
        setError(null);
      }

      try {
        const result = await asyncFn(...args);

        // Only update state if this is still the latest execution
        if (executionId === executionIdRef.current) {
          setData(result);
          setStatus('success');
          onSuccess?.(result);
        }

        return result;
      } catch (err) {
        const errorObj = err instanceof Error ? err : new Error(String(err));

        // Only update state if this is still the latest execution
        if (executionId === executionIdRef.current) {
          setError(errorObj);
          setStatus('error');
          onError?.(errorObj);
        }

        throw errorObj;
      } finally {
        if (executionId === executionIdRef.current) {
          onSettled?.();
        }
      }
    },
    [asyncFn, onSuccess, onError, onSettled, resetErrorOnExecute]
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setData(initialData);
    setError(null);
    executionIdRef.current++;
  }, [initialData]);

  const setDataCallback = useCallback((newData: T | null) => {
    setData(newData);
    if (newData !== null) {
      setStatus('success');
    }
  }, []);

  const setErrorCallback = useCallback((newError: Error | null) => {
    setError(newError);
    if (newError !== null) {
      setStatus('error');
    }
  }, []);

  return {
    status,
    data,
    error,
    isLoading: status === 'loading',
    isSuccess: status === 'success',
    isError: status === 'error',
    isIdle: status === 'idle',
    execute,
    reset,
    setData: setDataCallback,
    setError: setErrorCallback,
  };
}

/**
 * Simplified version for boolean loading states.
 * Useful for simple operations that don't need full async state management.
 *
 * @example
 * ```tsx
 * const { isLoading, withLoading } = useLoadingState();
 *
 * const handleDelete = () => {
 *   withLoading(async () => {
 *     await api.deleteUser(userId);
 *   });
 * };
 *
 * return (
 *   <Button disabled={isLoading}>
 *     {isLoading ? 'Deleting...' : 'Delete'}
 *   </Button>
 * );
 * ```
 */
export function useLoadingState() {
  const [isLoading, setIsLoading] = useState(false);

  const withLoading = useCallback(async <T>(fn: () => Promise<T>): Promise<T> => {
    setIsLoading(true);
    try {
      return await fn();
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    isLoading,
    setIsLoading,
    withLoading,
  };
}
