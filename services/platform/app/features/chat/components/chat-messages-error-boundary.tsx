'use client';

import { type ReactNode } from 'react';

import { isConvexTransientError } from '@/app/components/error-boundaries/boundaries/layout-error-boundary';
import { ErrorBoundaryBase } from '@/app/components/error-boundaries/core/error-boundary-base';
import { ErrorDisplayCompact } from '@/app/components/error-boundaries/displays/error-display-compact';

const MAX_RETRIES = 3;

interface ChatMessagesErrorBoundaryProps {
  children: ReactNode;
  organizationId: string;
  /** Reset the boundary when the user switches threads. */
  threadId: string | undefined;
}

/**
 * Scoped error boundary around the transcript.
 *
 * A render/stream crash inside the message list (malformed chunk, a bad
 * markdown payload, a reconnection edge) shows a recoverable error IN THE
 * SCROLL AREA without unmounting the composer and header — unlike the
 * router's default error component, which would take the whole route down
 * with the user's draft. Transient Convex/reconnection errors auto-retry
 * (shared `isConvexTransientError`), and the boundary resets on thread
 * switch.
 */
export function ChatMessagesErrorBoundary({
  children,
  organizationId,
  threadId,
}: ChatMessagesErrorBoundaryProps) {
  return (
    <ErrorBoundaryBase
      organizationId={organizationId}
      resetKeys={[threadId]}
      maxRetries={MAX_RETRIES}
      isRetryableError={isConvexTransientError}
      fallback={(fallbackProps) => (
        <ErrorDisplayCompact
          error={fallbackProps.error}
          organizationId={fallbackProps.organizationId}
          reset={fallbackProps.reset}
        />
      )}
    >
      {children}
    </ErrorBoundaryBase>
  );
}
