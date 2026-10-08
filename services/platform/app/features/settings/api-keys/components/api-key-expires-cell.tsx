'use client';

import { Badge } from '@tale/ui/badge';
import { TableDateCell } from '@tale/ui/table-date-cell';
import { useFormatDate } from '@tale/ui/use-format-date';

import { useT } from '@/lib/i18n/client';

interface ApiKeyExpiresCellProps {
  expiresAt: Date | string | number | null;
}

/**
 * When a key stops working: its date, "Never", or — for a key that ran out
 * while the list was open — "Expired". The api-key plugin deletes an expired
 * key the next time it reads the list, so an expired row does not linger.
 */
export function ApiKeyExpiresCell({ expiresAt }: ApiKeyExpiresCellProps) {
  const { t } = useT('settings');
  const { formatDate } = useFormatDate();

  if (expiresAt !== null && new Date(expiresAt).getTime() <= Date.now()) {
    return (
      <Badge
        variant="orange"
        title={formatDate(new Date(expiresAt), 'long')}
        className="align-middle"
      >
        {t('apiKeys.expired')}
      </Badge>
    );
  }
  return (
    <TableDateCell
      date={expiresAt}
      preset="short"
      emptyText={t('apiKeys.neverExpires')}
    />
  );
}
