'use client';

import { Component } from 'react';

import type { ErrorBoundaryBaseProps, ErrorBoundaryState } from './types';

import { ErrorBoundaryContext } from './error-context';

const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 4000;

function getRetryDelay(retryCount: number): number {
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** retryCount, RETRY_MAX_DELAY_MS);
}

/**
 * Base error boundary class component that all specialized boundaries build upon.
 *
 * Features:
 * - Catches JavaScript errors in child component tree
 * - Provides error context to descendants via React Context
 * - Supports resetKeys pattern for automatic reset on value changes
 * - Auto-retry with exponential backoff for transient errors
 * - Custom reset handlers
 * - Error logging callbacks
 */
export class ErrorBoundaryBase extends Component<
  ErrorBoundaryBaseProps,
  ErrorBoundaryState
> {
  private resetKeysRef: unknown[];
  private retryTimerId: ReturnType<typeof setTimeout> | null = null;

  constructor(props: ErrorBoundaryBaseProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      retryCount: 0,
      isRetrying: false,
    };
    this.resetKeysRef = props.resetKeys || [];
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.props.onError?.(error, errorInfo);

    const { maxRetries = 0, isRetryableError } = this.props;
    const { retryCount } = this.state;

    if (
      maxRetries > 0 &&
      retryCount < maxRetries &&
      isRetryableError?.(error)
    ) {
      const delay = getRetryDelay(retryCount);
      this.setState({ isRetrying: true });

      this.retryTimerId = setTimeout(() => {
        this.retryTimerId = null;
        this.setState((prev) => ({
          hasError: false,
          error: null,
          retryCount: prev.retryCount + 1,
          isRetrying: false,
        }));
      }, delay);
    }
  }

  componentDidUpdate(prevProps: ErrorBoundaryBaseProps) {
    const { resetKeys = [] } = this.props;
    const prevResetKeys = prevProps.resetKeys || [];

    if (this.state.hasError) {
      const hasResetKeysChanged =
        resetKeys.length !== prevResetKeys.length ||
        resetKeys.some((key, index) => key !== prevResetKeys[index]);

      if (hasResetKeysChanged) {
        this.reset();
      }
    }

    this.resetKeysRef = resetKeys;
  }

  componentWillUnmount() {
    if (this.retryTimerId !== null) {
      clearTimeout(this.retryTimerId);
      this.retryTimerId = null;
    }
  }

  reset = () => {
    if (this.retryTimerId !== null) {
      clearTimeout(this.retryTimerId);
      this.retryTimerId = null;
    }

    this.props.onReset?.();

    this.setState({
      hasError: false,
      error: null,
      retryCount: 0,
      isRetrying: false,
    });
  };

  render() {
    const { hasError, error, isRetrying } = this.state;
    const { children, fallback, organizationId } = this.props;

    const contextValue = {
      hasError: hasError && !isRetrying,
      error: isRetrying ? null : error,
      reset: this.reset,
      organizationId,
    };

    // Auto-retry in progress: render nothing so Suspense ancestor shows its fallback
    if (hasError && isRetrying) {
      return (
        <ErrorBoundaryContext.Provider value={contextValue}>
          {null}
        </ErrorBoundaryContext.Provider>
      );
    }

    // Retries exhausted or non-retryable: show error fallback
    if (hasError && error) {
      return (
        <ErrorBoundaryContext.Provider value={contextValue}>
          {fallback({ error, organizationId, reset: this.reset })}
        </ErrorBoundaryContext.Provider>
      );
    }

    return (
      <ErrorBoundaryContext.Provider value={contextValue}>
        {children}
      </ErrorBoundaryContext.Provider>
    );
  }
}
