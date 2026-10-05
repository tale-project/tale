import { createContext, useContext } from 'react';

import { useT } from '@/lib/i18n/client';

export const PolicyReadAccessContext = createContext<{
  current: boolean;
} | null>(null);

export function usePolicyReadAvailable() {
  const access = useContext(PolicyReadAccessContext);
  return access?.current ?? true;
}

export function usePolicyReadWriteGuard() {
  const access = useContext(PolicyReadAccessContext);
  const { t } = useT('governance');
  return () => {
    if (access?.current === false) throw new Error(t('policyReadFailed'));
  };
}
