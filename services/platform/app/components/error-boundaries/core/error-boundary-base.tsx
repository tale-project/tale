'use client';

import { Component } from 'react';

import type { ErrorBoundaryBaseProps, ErrorBoundaryState } from './types';

import { ErrorBoundaryContext } from './error-context';

/**
 * Base error boundary class component that all specialized boundaries build upon.
 *
 * Features:
 * - Catches JavaScript errors in child component tree
 * - Provides error context to descendants via React Context
 * - Supports resetKeys pattern for automatic reset on value changes
 * - Custom reset handlers
 * - Error logging callbacks
 *
 * @example
 * <ErrorBoundaryBase
 *   fallback={({ error, reset }) => (
 *     <div>
 *       <p>Error: {error.message}</p>
 *       <button onClick={reset}>Try Again</button>
 *     </div>
 *   )}
 *   resetKeys={[pathname, userId]}
 *   onError={(error, errorInfo) => logError(error, errorInfo)}
 * >
 *   <App />
 * </ErrorBoundaryBase>
 */
export class ErrorBoundaryBase extends Component<
  ErrorBoundaryBaseProps,
  ErrorBoundaryState
> {
  private resetKeysRef: unknown[];

  constructor(props: ErrorBoundaryBaseProps) {
    super(props);
    this.state = { hasError: false, error: null };
    this.resetKeysRef = props.resetKeys || [];
  }

  /**
   * Update state when an error is caught
   */
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  /**
   * Log error when caught
   */
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Call custom error handler if provided
    this.props.onError?.(error, errorInfo);
  }

  /**
   * Check if resetKeys have changed and reset boundary if so
   */
  componentDidUpdate(prevProps: ErrorBoundaryBaseProps) {
    const { resetKeys = [] } = this.props;
    const prevResetKeys = prevProps.resetKeys || [];

    // Check if resetKeys have changed
    if (this.state.hasError) {
      const hasResetKeysChanged =
        resetKeys.length !== prevResetKeys.length ||
        resetKeys.some((key, index) => key !== prevResetKeys[index]);

      if (hasResetKeysChanged) {
        this.reset();
      }
    }

    // Update ref
    this.resetKeysRef = resetKeys;
  }

  /**
   * Reset the error boundary to initial state
   */
  reset = () => {
    // Call custom reset handler if provided
    this.props.onReset?.();

    // Reset state
    this.setState({ hasError: false, error: null });
  };

  render() {
    const { hasError, error } = this.state;
    const { children, fallback, organizationId } = this.props;

    // Context value for descendants
    const contextValue = {
      hasError,
      error,
      reset: this.reset,
      organizationId,
    };

    // If error occurred, render fallback
    if (hasError && error) {
      const fallbackElement = fallback({
        error,
        organizationId,
        reset: this.reset,
      });

      return (
        <ErrorBoundaryContext.Provider value={contextValue}>
          {fallbackElement}
        </ErrorBoundaryContext.Provider>
      );
    }

    // No error, render children
    return (
      <ErrorBoundaryContext.Provider value={contextValue}>
        {children}
      </ErrorBoundaryContext.Provider>
    );
  }
}
