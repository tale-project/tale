'use client';

import { Button } from '@tale/ui/button';
import { Heading } from '@tale/ui/heading';
import { useT } from '@tale/ui/i18n/client';
import { Stack, Center, HStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useEffect } from 'react';

import { useFocusHandoff } from '../../../hooks/use-focus-handoff';
import { supportUrlFor, useSupportUrl } from '../core/support-url';
import { useErrorLogger } from '../hooks/use-error-logger';

interface ErrorDisplayCompactProps {
  /** Localized description; defaults to the page loading message. */
  description?: string;
  /** The error that occurred */
  error: Error;
  /** Organization ID for support links */
  organizationId?: string;
  /** Function to reset the error boundary */
  reset: () => void;
  /**
   * Support page the "contact support" link opens; the organization is
   * appended as `organizationId`. Defaults to the nearest
   * `SupportUrlProvider`, else `https://tale.dev/contact`.
   */
  supportUrl?: string;
  /**
   * Takes the focus this display held when it leaves — a data table's error
   * state that a refresh replaced with its loading state or its rows — so
   * the focus lands on a stable target instead of the page. Focus the reader
   * moved elsewhere stays where it is.
   */
  onFocusLost?: () => void;
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
  description,
  organizationId,
  reset,
  supportUrl,
  onFocusLost,
}: ErrorDisplayCompactProps) {
  const { t } = useT('common');
  const logError = useErrorLogger();
  const supportHref = supportUrlFor(useSupportUrl(supportUrl), organizationId);
  const handoffRef = useFocusHandoff<HTMLDivElement>(onFocusLost);

  // Log error on mount
  useEffect(() => {
    logError(error, {
      organizationId,
      componentName: 'ErrorDisplayCompact',
    });
  }, [error, organizationId, logError]);

  return (
    <Center ref={handoffRef} className="min-h-200 flex-col px-4 py-16">
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
        <Text variant="muted">
          {description ?? t('errors.errorLoadingPage')}
        </Text>

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
            href={supportHref}
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
