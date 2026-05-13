'use client';

import { Button } from '@tale/ui/button';

import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';

interface QueryErrorBlockProps {
  /** Localized message describing what failed to load. */
  message: string;
  /** Re-invoke the failed query. */
  onRetry: () => void;
}

/**
 * Inline error UI for failed Convex queries. Use when a query in a dialog
 * surface throws and the caller wants to give the user a localized message
 * + a retry button rather than falling through to a blank/empty state.
 */
export function QueryErrorBlock({ message, onRetry }: QueryErrorBlockProps) {
  const { t } = useT('common');
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 py-6 text-center"
    >
      <Text variant="muted" className="text-sm">
        {message}
      </Text>
      <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
        {t('retry')}
      </Button>
    </div>
  );
}
