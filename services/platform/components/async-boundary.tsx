import { Suspense, type ReactNode } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { useT } from '@/lib/i18n';

interface ErrorFallbackProps {
  error: Error;
  resetErrorBoundary: () => void;
  className?: string;
}

/**
 * Default error fallback component.
 * Shows a user-friendly error message with retry option.
 */
function DefaultErrorFallback({
  error,
  resetErrorBoundary,
  className,
}: ErrorFallbackProps) {
  const { t } = useT('common');

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 p-8 text-center',
        className,
      )}
    >
      <div className="rounded-full bg-destructive/10 p-3">
        <AlertCircle className="h-6 w-6 text-destructive" />
      </div>
      <div className="space-y-1">
        <h3 className="font-medium text-foreground">{t('errors.somethingWentWrong')}</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          {error.message || t('errors.unexpectedError')}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={resetErrorBoundary}
        className="gap-2"
      >
        <RefreshCw className="h-4 w-4" />
        {t('errors.tryAgain')}
      </Button>
    </div>
  );
}

interface AsyncBoundaryProps {
  /** The async content to render */
  children: ReactNode;
  /** Loading fallback (skeleton) to show while content is loading */
  fallback: ReactNode;
  /** Optional custom error fallback component */
  errorFallback?: (props: ErrorFallbackProps) => ReactNode;
  /** Optional key to reset the boundary */
  resetKey?: string | number;
  /** Additional class name for the wrapper */
  className?: string;
}

/**
 * AsyncBoundary - Self-contained loading and error handling for async components.
 *
 * This component combines Suspense (for loading states) with ErrorBoundary
 * (for error handling) to create a complete async boundary.
 *
 * ## Usage:
 *
 * ```tsx
 * import { AsyncBoundary } from '@/components/async-boundary';
 * import { DataTableSkeleton } from '@/components/ui/data-table';
 *
 * // In your page or component:
 * <AsyncBoundary fallback={<DataTableSkeleton rows={10} />}>
 *   <CustomersTable />
 * </AsyncBoundary>
 * ```
 *
 * ## Self-Contained Pattern:
 *
 * For truly self-contained components, create a wrapper that includes its own boundary:
 *
 * ```tsx
 * // components/customers/customers-table-async.tsx
 * export function CustomersTableAsync(props: Props) {
 *   return (
 *     <AsyncBoundary fallback={<DataTableSkeleton rows={10} />}>
 *       <CustomersTableContent {...props} />
 *     </AsyncBoundary>
 *   );
 * }
 *
 * async function CustomersTableContent({ orgId }: Props) {
 *   const customers = await fetchCustomers(orgId);
 *   return <CustomersTable customers={customers} />;
 * }
 * ```
 *
 * ## Performance Benefits:
 * - Enables streaming: content loads progressively
 * - Prevents blocking: other parts of the page render immediately
 * - Graceful degradation: errors are contained to this boundary
 *
 * @see https://nextjs.org/docs/app/building-your-application/routing/loading-ui-and-streaming
 */
export function AsyncBoundary({
  children,
  fallback,
  errorFallback,
  resetKey,
  className,
}: AsyncBoundaryProps) {
  return (
    <ErrorBoundary
      key={resetKey}
      fallbackRender={({ error, resetErrorBoundary }) =>
        errorFallback ? (
          errorFallback({ error, resetErrorBoundary, className })
        ) : (
          <DefaultErrorFallback
            error={error}
            resetErrorBoundary={resetErrorBoundary}
            className={className}
          />
        )
      }
    >
      <Suspense fallback={fallback}>{children}</Suspense>
    </ErrorBoundary>
  );
}

/**
 * Re-export for convenience - use this when you only need Suspense without error handling.
 * Prefer AsyncBoundary for production code as it handles errors gracefully.
 */
export { Suspense };
