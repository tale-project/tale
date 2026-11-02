import { useMemo } from 'react';

import type { CheckStatus } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

/**
 * The words of a state of a check ("Working", "Not working") in the person's
 * language: the badge of a row says them, and the search finds them, so they
 * are worded in one place. One literal `t('…')` per state, as the i18n usage
 * check cannot read a key built from the state.
 */
export function useHealthLabel(): (status: CheckStatus) => string {
  const { t } = useT('proxies');
  return useMemo(() => {
    const labels: Record<CheckStatus, string> = {
      ok: t('health.ok'),
      failed: t('health.failed'),
      checking: t('health.checking'),
      unchecked: t('health.unchecked'),
    };
    return (status) => labels[status];
  }, [t]);
}
