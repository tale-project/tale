import { useMemo } from 'react';

import { useStatusLabel } from '@/app/features/sessions/components/session-status';
import type { Proxy } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { sessionCellOf } from '../lib/session-cell';
import { useHealthLabel } from './use-health-label';
import { useRegionName } from './use-region-name';

/**
 * What the search of the table looks at in a proxy: its address (with the type
 * and the login), where it exits, and the WORDS the cells say of it: the health
 * ("Not working"), the reason a check failed, whether a session can have it
 * ("Free", "Not assigned", "Same IP as ...") and the state of the session that
 * has it. What a person reads in the table is what they can type, in the
 * language they read it in, not the English of the API.
 */
export function useProxySearchFields() {
  const { t } = useT('proxies');
  const regionName = useRegionName();
  const healthLabel = useHealthLabel();
  const statusLabel = useStatusLabel();

  return useMemo(() => {
    const sessionWord = (proxy: Proxy): string => {
      const cell = sessionCellOf(proxy);
      if (cell.kind === 'session') return statusLabel(cell.session.status);
      if (cell.kind === 'free') return t('session.free');
      return t('session.notAssigned');
    };
    return [
      'display' as const,
      (proxy: Proxy) => proxy.check.exitIp,
      (proxy: Proxy) => proxy.check.country,
      (proxy: Proxy) =>
        proxy.check.country === null ? null : regionName(proxy.check.country),
      (proxy: Proxy) => healthLabel(proxy.check.status),
      (proxy: Proxy) => proxy.check.error,
      sessionWord,
      (proxy: Proxy) => proxy.session?.name,
      // The flag of a shared exit IP, as the cell words it ("Same IP as 0003"),
      // which holds the name of the other session.
      (proxy: Proxy) =>
        proxy.sameIpAs === null
          ? null
          : t('session.sameIp', { name: proxy.sameIpAs.name }),
    ];
  }, [t, regionName, healthLabel, statusLabel]);
}
