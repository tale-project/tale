import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

export type RetentionUnit = 'days' | 'hours';

/** The retention surfaces' small words, in the language of the page. */
export interface RetentionText {
  /** A stored value or a bound with its unit, singular or plural: "1 day",
   * "24 hours", "3,650 days". */
  value(count: number, unit: RetentionUnit): string;
  /** The unit's plural noun, for a range or a limit: "days". */
  unit(unit: RetentionUnit): string;
  /** Whether a category's cleanup is on, as a row of a diff reads it. */
  state(enabled: boolean): string;
}

export function useRetentionText(): RetentionText {
  const { t } = useT('governance');
  return useMemo(
    () => ({
      value: (count, unit) =>
        unit === 'hours'
          ? t('retentionPolicy.valueHours', '{count} hours', { count })
          : t('retentionPolicy.valueDays', '{count} days', { count }),
      unit: (unit) =>
        unit === 'hours'
          ? t('retentionPolicy.unitHours', 'hours')
          : t('retentionPolicy.unitDays', 'days'),
      state: (enabled) =>
        enabled
          ? t('retentionPolicy.stateOn', 'enabled')
          : t('retentionPolicy.stateOff', 'disabled'),
    }),
    [t],
  );
}
