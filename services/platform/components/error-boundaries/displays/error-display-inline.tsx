'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HStack } from '@/components/ui/layout';
import { useT } from '@/lib/i18n';
import { useErrorLogger } from '../hooks/use-error-logger';

interface ErrorDisplayInlineProps {
  /** The error that occurred */
  error: Error;
  /** Organization ID for context */
  organizationId?: string;
  /** Function to reset the error boundary */
  reset: () => void;
}

/**
 * Inline error display for small spaces like table cells or status indicators.
 *
 * Features:
 * - Minimal single-line display
 * - Small icon + message + retry button
 * - Fits within existing component bounds
 * - WCAG Level AA compliant
 *
 * Used in:
 * - Table cells with complex rendering
 * - Status indicators
 * - Small widgets
 *
 * @example
 * <ErrorDisplayInline
 *   error={error}
 *   organizationId={organizationId}
 *   reset={reset}
 * />
 */
export function ErrorDisplayInline({
  error,
  organizationId,
  reset,
}: ErrorDisplayInlineProps) {
  const { t } = useT('common');
  const logError = useErrorLogger();

  // Log error on mount
  useEffect(() => {
    logError(error, {
      organizationId,
      componentName: 'ErrorDisplayInline',
    });
  }, [error, organizationId, logError]);

  return (
    <HStack gap={2} className="items-center text-sm text-muted-foreground" role="alert" aria-live="assertive">
      <AlertTriangle className="size-4 text-red-600 flex-shrink-0" aria-hidden="true" />
      <span className="flex-1">{t('errors.errorLoadingPage')}</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={reset}
        className="h-auto py-1 px-2"
        aria-label={t('errors.tryAgain')}
      >
        <RefreshCw className="size-3" />
      </Button>
    </HStack>
  );
}
