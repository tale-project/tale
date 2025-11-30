'use client';

import React, { Component, ReactNode, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useParams, usePathname } from 'next/navigation';

type ErrorSize = 'default' | 'compact';

interface ErrorBoundaryProps {
  children: ReactNode;
  organizationId?: string;
  size?: ErrorSize;
  header?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// Error display component with configurable size
function ErrorDisplay({
  error,
  reset,
  organizationId,
  size = 'default',
  header,
}: {
  error: Error;
  reset: () => void;
  organizationId?: string;
  size?: ErrorSize;
  header?: ReactNode;
}) {
  useEffect(() => {
    console.error('ErrorBoundary caught an error:', error, {
      organizationId,
      errorMessage: error.message,
      errorStack: error.stack,
    });
  }, [error, organizationId]);

  const isCompact = size === 'compact';

  return (
    <>
      {header}
      <div className="flex-1 flex flex-col items-center px-4 py-[10rem]">
        <div
          className={`space-y-4 w-full ${isCompact ? 'max-w-md text-center' : 'max-w-[28rem]'}`}
        >
          {/* Error icon and title */}
          <div className="text-center space-y-4">
            <div
              className={`mx-auto bg-red-100 rounded-full flex items-center justify-center ${isCompact ? 'w-12 h-12' : 'w-16 h-16'}`}
            >
              <AlertTriangle
                className={`text-red-600 ${isCompact ? 'size-6' : 'size-8'}`}
              />
            </div>
            <h2
              className={`text-foreground ${isCompact ? 'text-lg font-semibold' : 'text-3xl font-extrabold tracking-tight'}`}
            >
              Something went wrong
            </h2>
            <p
              className={`text-muted-foreground ${isCompact ? 'text-sm' : ''}`}
            >
              {isCompact
                ? 'An error occurred while loading this page. You can try again or navigate to another section.'
                : 'An unexpected error occurred while loading this page. This might be a temporary issue.'}
            </p>
          </div>

          {/* Action buttons */}
          <div className={`flex ${isCompact ? 'gap-2' : 'gap-3'}`}>
            <Button onClick={reset} className="flex-1">
              <RefreshCw className="size-4 mr-2" />
              Try again
            </Button>
          </div>

          {/* Support message */}
          <div className="text-center">
            <p className="text-sm text-muted-foreground">
              If this problem persists, please{' '}
              <a
                href={
                  organizationId
                    ? `https://tale.dev/contact?organizationId=${organizationId}`
                    : 'https://tale.dev/contact'
                }
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                contact support
              </a>
              {isCompact ? '.' : ' for assistance.'}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <ErrorDisplay
          error={this.state.error}
          reset={this.reset}
          organizationId={this.props.organizationId}
          size={this.props.size}
          header={this.props.header}
        />
      );
    }

    return this.props.children;
  }
}

// Wrapper component that gets organizationId from params and resets on route change
export function ErrorBoundaryWithParams({ children }: { children: ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const organizationId = params?.id as string | undefined;

  // Use pathname as key to reset error boundary when route changes
  return (
    <ErrorBoundary
      key={pathname}
      organizationId={organizationId}
      size="compact"
    >
      {children}
    </ErrorBoundary>
  );
}

// Component for Next.js error.tsx files (large format)
interface DashboardErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
  organizationId?: string;
  header?: ReactNode;
}

export function DashboardErrorBoundary({
  error,
  reset,
  organizationId,
  header,
}: DashboardErrorBoundaryProps) {
  return (
    <ErrorDisplay
      error={error}
      reset={reset}
      organizationId={organizationId}
      size="default"
      header={header}
    />
  );
}
