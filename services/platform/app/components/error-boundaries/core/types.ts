import type { ReactNode, ErrorInfo } from 'react';

/**
 * Size variants for error displays
 */
export type ErrorBoundarySize = 'full' | 'compact' | 'inline';

/**
 * Props passed to error fallback render functions
 */
export interface ErrorFallbackProps {
  /** The error that was caught */
  error: Error;
  /** Organization ID for support links */
  organizationId?: string;
  /** Function to reset the error boundary */
  reset: () => void;
  /** Optional custom header content */
  header?: ReactNode;
}

/**
 * Base props for all error boundary components
 */
export interface ErrorBoundaryBaseProps {
  /** Child components to wrap with error boundary */
  children: ReactNode;
  /** Function to render fallback UI when error occurs */
  fallback: (props: ErrorFallbackProps) => ReactNode;
  /** Callback when error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Callback when reset is triggered */
  onReset?: () => void;
  /** Array of values that trigger boundary reset when changed */
  resetKeys?: unknown[];
  /** Organization ID for context */
  organizationId?: string;
}

/**
 * Internal state for error boundary class component
 */
export interface ErrorBoundaryState {
  /** Whether an error has been caught */
  hasError: boolean;
  /** The caught error, if any */
  error: Error | null;
}

/**
 * Context value provided by error boundary
 */
export interface ErrorBoundaryContextValue {
  /** Whether an error has occurred */
  hasError: boolean;
  /** The current error, if any */
  error: Error | null;
  /** Function to reset the error boundary */
  reset: () => void;
  /** Organization ID for support links */
  organizationId?: string;
}
