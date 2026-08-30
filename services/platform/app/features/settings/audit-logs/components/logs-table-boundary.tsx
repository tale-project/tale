'use client';

import { Button } from '@tale/ui/button';
import { Center, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { type ReactNode } from 'react';

import { isConvexTransientError } from '@/app/components/error-boundaries/boundaries/layout-error-boundary';
import { ErrorBoundaryBase } from '@/app/components/error-boundaries/core/error-boundary-base';
import type { UsePaginatedQueryResult } from '@/app/hooks/use-convex-paginated-query';
import type { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import type { AuditLogTableVariant } from '../hooks/use-audit-log-table-config';
import { AuditLogTable } from './audit-log-table';

// Match the layout boundary so a flaky governance backend gets the same number
// of silent retries before the user has to act.
const MAX_RETRIES = 3;

// A paginated result frozen in its first-page-loading state. Reused as the
// auto-retry placeholder so the backoff window shows the *real* table skeleton
// (driven by the same `DataTable` self-skeleton path the live load uses) rather
// than a blank gap.
const LOADING_RESULT: UsePaginatedQueryResult<Doc<'auditLogs'>> = {
  results: [],
  status: 'LoadingFirstPage',
  loadMore: () => {},
  isLoading: true,
};

interface LogsTableBoundaryProps {
  children: ReactNode;
  /** `errors` skeletonizes with the error-column layout. */
  variant?: AuditLogTableVariant;
  /**
   * Values that reset the boundary when they change (e.g. the active category
   * filter) so switching filters clears a stuck error instead of stranding the
   * user on the retry card.
   */
  resetKeys?: unknown[];
}

/**
 * Table-scoped error boundary for the governance logs tabs.
 *
 * A paginated Convex query that times out throws from the component that reads
 * it, which would otherwise escalate to the page-level (full-panel) boundary
 * and replace the whole Logs panel — heading, tabs, filters, export — with a
 * hard error. Wrapping just the query-owning table subtree keeps that chrome
 * mounted and degrades only the table:
 *
 * - Transient timeouts auto-retry up to {@link MAX_RETRIES} times with backoff,
 *   showing the table skeleton during each backoff window.
 * - If the retries are exhausted (or the error isn't transient) the table area
 *   shows an inline retry card instead of the full-panel error.
 */
export function LogsTableBoundary({
  children,
  variant = 'audit',
  resetKeys,
}: LogsTableBoundaryProps) {
  return (
    <ErrorBoundaryBase
      resetKeys={resetKeys}
      maxRetries={MAX_RETRIES}
      isRetryableError={isConvexTransientError}
      retryingFallback={
        <AuditLogTable paginatedResult={LOADING_RESULT} variant={variant} />
      }
      fallback={(fallbackProps) => (
        <LogsTableErrorState reset={fallbackProps.reset} />
      )}
    >
      {children}
    </ErrorBoundaryBase>
  );
}

function LogsTableErrorState({ reset }: { reset: () => void }) {
  const { t } = useT('settings');

  return (
    <Center className="min-h-0 flex-1 px-4 py-12">
      <Stack gap={3} className="max-w-sm items-center text-center">
        <div
          className="bg-muted grid size-10 place-items-center rounded-full"
          role="img"
          aria-label={t('logs.loadError.title')}
        >
          <AlertTriangle className="text-muted-foreground size-5" />
        </div>
        <Stack gap={1} className="items-center">
          <Text as="span" className="font-medium">
            {t('logs.loadError.title')}
          </Text>
          <Text variant="muted" className="text-sm">
            {t('logs.loadError.description')}
          </Text>
        </Stack>
        <Button variant="secondary" icon={RefreshCw} onClick={reset}>
          {t('logs.loadError.retry')}
        </Button>
      </Stack>
    </Center>
  );
}
