import {
  EntityRowActions,
  useEntityRowDialogs,
  type EntityRowAction,
} from '@tale/ui/entity/entity-row-actions';
import { RefreshCw, Trash2 } from 'lucide-react';
import { useMemo } from 'react';

import type { Proxy } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { useCheckProxy } from '../hooks/use-proxy-actions';
import { hostPortOf } from '../lib/address';
import { isChecking } from '../lib/health';
import { DeleteProxyFlow } from './delete-proxy-flow';

export interface ProxyRowActionsProps {
  proxy: Proxy;
}

/**
 * The menu of a row: check the proxy again, or delete it. The menu button is
 * named after the proxy, so fifty rows are not fifty "Row actions". The row
 * owns what its menu does, as the platform's row actions do (the actions
 * column is `createActionsColumn(ProxyRowActions, 'proxy')`).
 */
export function ProxyRowActions({ proxy }: ProxyRowActionsProps) {
  const { t } = useT('proxies');
  const { t: tCommon } = useT('common');
  const dialogs = useEntityRowDialogs(['delete']);
  const { mutate: startCheck } = useCheckProxy();

  const actions = useMemo<EntityRowAction[]>(
    () => [
      {
        key: 'check',
        label: t('row.check'),
        icon: RefreshCw,
        onClick: () => startCheck({ id: proxy.id }),
        disabled: isChecking(proxy),
      },
      {
        key: 'delete',
        label: tCommon('actions.delete'),
        icon: Trash2,
        destructive: true,
        onClick: dialogs.open.delete,
      },
    ],
    [t, tCommon, proxy, startCheck, dialogs.open.delete],
  );

  return (
    <>
      <EntityRowActions
        actions={actions}
        ariaLabel={t('row.actionsFor', { proxy: hostPortOf(proxy) })}
      />
      {/* Mounted from its first open: every row of the table carries it. */}
      {dialogs.mounted.delete && (
        <DeleteProxyFlow
          proxy={proxy}
          open={dialogs.isOpen.delete}
          onOpenChange={dialogs.setOpen.delete}
        />
      )}
    </>
  );
}
