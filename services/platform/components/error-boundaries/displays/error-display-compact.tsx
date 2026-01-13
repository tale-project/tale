'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/primitives/button';
import { Stack, Center, HStack } from '@/components/ui/layout/layout';
import { useT } from '@/lib/i18n/client';
import { useErrorLogger } from '../hooks/use-error-logger';

interface ErrorDisplayCompactProps {
  /** The error that occurred */
  error: Error;
  /** Organization ID for support links */
  organizationId?: string;
  /** Function to reset the error boundary */
  reset: () => void;
}

/**
 * Compact error display for layouts and component sections.
 *
 * Features:
 * - Moderate size (py-16)
 * - Brief error message
 * - Try Again button
 * - Support contact link
 * - WCAG Level AA compliant
 *
 * Used in:
 * - Layout error boundaries
 * - Component sections
 * - Data tables
 *
 * @example
 * <ErrorDisplayCompact
 *   error={error}
 *   organizationId={organizationId}
 *   reset={reset}
 * />
 */
export function ErrorDisplayCompact({
  error,
  organizationId,
  reset,
}: ErrorDisplayCompactProps) {
  const { t } = useT('common');
  const logError = useErrorLogger();

  // Log error on mount
  useEffect(() => {
    logError(error, {
      organizationId,
      componentName: 'ErrorDisplayCompact',
    });
  }, [error, organizationId, logError]);

  return (
    <Center className="flex-col px-4 py-16">
      <Stack gap={4} className="w-full text-center max-w-md">
        {/* Error icon */}
        <Center>
          <div
            className="bg-red-100 rounded-full grid place-items-center size-12"
            role="img"
            aria-label={t('errors.somethingWentWrong')}
          >
            <AlertTriangle className="text-red-600 size-6" />
          </div>
        </Center>

        {/* Title */}
        <h2 className="text-foreground text-lg font-semibold">
          {t('errors.somethingWentWrong')}
        </h2>

        {/* Description */}
        <p className="text-muted-foreground text-sm">
          {t('errors.errorLoadingPage')}
        </p>

        {/* Action button */}
        <HStack gap={2} className="justify-center">
          <Button onClick={reset} className="flex-1" aria-label={t('errors.tryAgain')}>
            <RefreshCw className="size-4 mr-2" />
            {t('errors.tryAgain')}
          </Button>
        </HStack>

        {/* Support message */}
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
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
          .
        </p>
      </Stack>
    </Center>
  );
}
