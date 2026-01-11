'use client';

import { useEffect, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Stack, Center, HStack } from '@/components/ui/layout';
import { useT } from '@/lib/i18n';
import { useErrorLogger } from '../hooks/use-error-logger';

interface ErrorDisplayFullProps {
  /** The error that occurred */
  error: Error;
  /** Organization ID for support links */
  organizationId?: string;
  /** Function to reset the error boundary */
  reset: () => void;
  /** Optional custom header content (e.g., logo, user button) */
  header?: ReactNode;
}

/**
 * Full-page error display for critical errors in error.tsx files.
 *
 * Features:
 * - Large, prominent display (py-[10rem])
 * - Full error message
 * - Support contact link with organization context
 * - Try Again button
 * - Optional custom header
 * - WCAG Level AA compliant
 *
 * @example
 * <ErrorDisplayFull
 *   error={error}
 *   organizationId={organizationId}
 *   reset={reset}
 *   header={<AppHeader />}
 * />
 */
export function ErrorDisplayFull({
  error,
  organizationId,
  reset,
  header,
}: ErrorDisplayFullProps) {
  const { t } = useT('common');
  const logError = useErrorLogger();

  // Log error on mount
  useEffect(() => {
    logError(error, {
      organizationId,
      componentName: 'ErrorDisplayFull',
    });
  }, [error, organizationId, logError]);

  return (
    <>
      {header}
      <Center className="flex-col px-4 py-[10rem]">
        <Stack gap={4} className="w-full text-center max-w-[28rem]">
          {/* Error icon */}
          <Center>
            <div
              className="bg-red-100 rounded-full grid place-items-center size-16"
              role="img"
              aria-label={t('errors.somethingWentWrong')}
            >
              <AlertTriangle className="text-red-600 size-8" />
            </div>
          </Center>

          {/* Title */}
          <h2 className="text-foreground text-3xl font-extrabold tracking-tight">
            {t('errors.somethingWentWrong')}
          </h2>

          {/* Description */}
          <p className="text-muted-foreground">
            {t('errors.unexpectedErrorLoading')}
          </p>

          {/* Action button */}
          <HStack gap={3} className="justify-center">
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
            {` ${t('errors.forAssistance')}`}
          </p>
        </Stack>
      </Center>
    </>
  );
}
