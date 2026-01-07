'use client';

import React, { Component, ReactNode, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Stack, Center, HStack } from '@/components/ui/layout';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n';

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
  organizationId,
  size = 'default',
  header,
}: {
  error: Error;
  organizationId?: string;
  size?: ErrorSize;
  header?: ReactNode;
}) {
  const { t } = useT('common');
  const router = useRouter();

  const reset = () => {
    router.refresh();
  };

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
      <Center className={`flex-col px-4 ${isCompact ? 'py-16' : 'py-[10rem]'}`}>
        <Stack
          gap={4}
          className={`w-full text-center ${isCompact ? 'max-w-md' : 'max-w-[28rem]'}`}
        >
          {/* Error icon */}
          <Center>
            <div
              className={`bg-red-100 rounded-full grid place-items-center ${isCompact ? 'size-12' : 'size-16'}`}
            >
              <AlertTriangle
                className={`text-red-600 ${isCompact ? 'size-6' : 'size-8'}`}
              />
            </div>
          </Center>

          {/* Title */}
          <h2
            className={`text-foreground ${isCompact ? 'text-lg font-semibold' : 'text-3xl font-extrabold tracking-tight'}`}
          >
            {t('errors.somethingWentWrong')}
          </h2>

          {/* Description */}
          <p className={`text-muted-foreground ${isCompact ? 'text-sm' : ''}`}>
            {isCompact
              ? t('errors.errorLoadingPage')
              : t('errors.unexpectedErrorLoading')}
          </p>

          {/* Action buttons */}
          <HStack gap={isCompact ? 2 : 3} className="justify-center">
            <Button onClick={reset} className="flex-1">
              <RefreshCw className="size-4 mr-2" />
              {t('errors.tryAgain')}
            </Button>
          </HStack>

          {/* Support message */}
          <p className="text-sm text-muted-foreground">
            {t('errors.persistsProblem')}{' '}
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
              {t('errors.contactSupport')}
            </a>
            {isCompact ? '.' : ` ${t('errors.forAssistance')}`}
          </p>
        </Stack>
      </Center>
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
  organizationId?: string;
  header?: ReactNode;
}

export function DashboardErrorBoundary({
  error,
  organizationId,
  header,
}: DashboardErrorBoundaryProps) {
  return (
    <ErrorDisplay
      error={error}
      organizationId={organizationId}
      size="default"
      header={header}
    />
  );
}
