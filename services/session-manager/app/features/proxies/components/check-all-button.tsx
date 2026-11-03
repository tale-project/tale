import { Button } from '@tale/ui/button';
import { RefreshCw } from 'lucide-react';

import { useMeta } from '@/app/hooks/use-meta';
import { useT } from '@/lib/i18n/client';

import { useCheckAllProxies } from '../hooks/use-proxy-actions';

/**
 * Starts a check of every proxy, from the table's toolbar beside the way to add
 * one. It has nothing to do while every proxy is being checked already; it then
 * says so instead of leaving the tab order, so the person who pressed it keeps
 * their place. With no proxy the toolbar is not there, and this with it.
 */
export function CheckAllButton() {
  const { t } = useT('proxies');
  const meta = useMeta();
  const checkAll = useCheckAllProxies();
  const counts = meta.data?.counts;

  // Until the counts are known the button waits quietly: saying every proxy is
  // being checked could be wrong. While its own request runs it counts as busy
  // too, rather than as natively disabled, which would take the focus from the
  // person who pressed it.
  const busy =
    checkAll.isPending ||
    (counts !== undefined &&
      counts.proxies > 0 &&
      counts.checkingProxies >= counts.proxies);
  const reason = busy ? t('checkAll.busy') : undefined;

  return (
    <Button
      type="button"
      variant="secondary"
      icon={RefreshCw}
      // What it does, for whoever rests on it. Always there, though it adds
      // little: the button is rebuilt when a tooltip appears or goes, which
      // would take the focus from the person who pressed it.
      title={t('checkAll.title')}
      isLoading={checkAll.isPending}
      disabled={counts === undefined || reason !== undefined}
      disabledReason={reason}
      onClick={() => checkAll.mutate()}
    >
      {t('actions.checkAll')}
    </Button>
  );
}
