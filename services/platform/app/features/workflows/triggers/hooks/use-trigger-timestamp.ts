import { useCallback } from 'react';

import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';

/**
 * Formats a trigger timestamp as a long date, or the localized "never" label
 * when absent. Shared by the schedules / events / webhooks trigger sections.
 */
export function useTriggerTimestamp() {
  const { t } = useT('workflows');
  const { formatDate: formatDateLong } = useFormatDate();
  return useCallback(
    (timestamp?: number) => {
      if (!timestamp) return t('triggers.common.never');
      return formatDateLong(new Date(timestamp), 'long');
    },
    [t, formatDateLong],
  );
}
