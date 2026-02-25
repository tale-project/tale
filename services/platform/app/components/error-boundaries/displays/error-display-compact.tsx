'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useEffect } from 'react';

import { Stack, Center, HStack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { Heading } from '@/app/components/ui/typography/heading';
import { Text } from '@/app/components/ui/typography/text';
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
    <Center className="min-h-200 flex-col px-4 py-16">
      <Stack gap={4} className="w-full max-w-md text-center">
        {/* Error icon */}
        <Center>
          <div
            className="grid size-12 place-items-center rounded-full bg-red-100"
            role="img"
            aria-label={t('errors.somethingWentWrong')}
          >
            <AlertTriangle className="size-6 text-red-600" />
          </div>
        </Center>

        {/* Title */}
        <Heading level={2} size="lg">
          {t('errors.somethingWentWrong')}
        </Heading>

        {/* Description */}
        <Text variant="muted">{t('errors.errorLoadingPage')}</Text>

        {/* Action button */}
        <HStack gap={2} className="justify-center">
          <Button
            onClick={reset}
            className="flex-1"
            aria-label={t('errors.tryAgain')}
          >
            <RefreshCw className="mr-2 size-4" />
            {t('errors.tryAgain')}
          </Button>
        </HStack>

        {/* Support message */}
        <Text variant="muted" role="status" aria-live="polite">
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
        </Text>
      </Stack>
    </Center>
  );
}
