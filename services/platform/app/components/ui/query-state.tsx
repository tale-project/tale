'use client';

import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { ErrorDisplayCompact } from '@/app/components/error-boundaries/displays/error-display-compact';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

type QueryStateView<Data> =
  | { status: 'pending' }
  | { status: 'error'; error: Error; retry: () => void }
  | { status: 'success'; data: Data };

/**
 * Collapse a `useConvexQuery` result into a discriminated union. A Convex query
 * value is never `undefined` once loaded (absent values are `null`), so
 * `data === undefined` reliably means "still loading". Errors are never
 * conflated with empty data.
 */
export function useQueryState<Data>(
  result: UseQueryResult<Data>,
): QueryStateView<Data> {
  if (result.isError) {
    return {
      status: 'error',
      error:
        result.error instanceof Error
          ? result.error
          : new Error(String(result.error)),
      retry: () => {
        void result.refetch();
      },
    };
  }
  if (result.data === undefined) {
    return { status: 'pending' };
  }
  return { status: 'success', data: result.data };
}

interface QueryStateProps<Data> {
  /** The result of a single `useConvexQuery` call. */
  query: UseQueryResult<Data>;
  /** Skeleton shown while the first result loads. */
  pending: ReactNode;
  /** Rendered once data has loaded. */
  children: (data: Data) => ReactNode;
  /** Optional empty state, shown when `isEmpty(data)` is true. */
  empty?: ReactNode;
  isEmpty?: (data: Data) => boolean;
  /** Optional error override; defaults to the shared compact error + retry. */
  error?: (view: { error: Error; retry: () => void }) => ReactNode;
  /** Applied to the loaded-content wrapper (it owns the fade-in transition). */
  className?: string;
}

/**
 * Declarative four-state boundary for a single Convex query: loading → skeleton,
 * error → retry, empty → empty state, data → render. Wraps the loading branch in
 * `aria-busy`/`role=status` and fades content in on load (reduced-motion safe).
 * Composes with existing skeleton/empty components — pass them as props.
 *
 * Not for DataTable list pages: the table already owns a count-aware loading /
 * empty / filtered-empty state machine — route `isLoading`/`error`/`refetch`
 * into its props instead.
 */
export function QueryState<Data>({
  query,
  pending,
  children,
  empty,
  isEmpty,
  error,
  className,
}: QueryStateProps<Data>) {
  const { t } = useT('common');
  const view = useQueryState(query);

  if (view.status === 'pending') {
    return (
      <div role="status" aria-busy="true" aria-label={t('loading.label')}>
        {pending}
      </div>
    );
  }

  if (view.status === 'error') {
    if (error) return <>{error(view)}</>;
    return <ErrorDisplayCompact error={view.error} reset={view.retry} />;
  }

  if (empty && isEmpty?.(view.data)) {
    return <>{empty}</>;
  }

  return (
    <div className={cn('animate-content-in', className)}>
      {children(view.data)}
    </div>
  );
}
