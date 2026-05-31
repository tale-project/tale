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
 * Scoped error boundary around the message list.
 *
 * A render/stream crash inside the message list (malformed chunk, a bad
 * markdown payload, a reconnection edge in the agent SDK) shows a recoverable
 * error IN THE SCROLL AREA without unmounting the composer and header — unlike
 * the page-level `LayoutErrorBoundary` wrapping `ThreadGate`, which would take
 * the whole column down. Transient Convex/reconnection errors auto-retry
 * (shared `isConvexTransientError`), and the boundary resets on thread switch.
 *
 * Renders only a Context.Provider (no DOM node), so the scroll/min-height
 * observers in `ChatMessages` are unaffected.
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
