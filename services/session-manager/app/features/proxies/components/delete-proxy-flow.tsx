import { useState } from 'react';

import { ApiError } from '@/app/lib/api/client';
import type { Proxy } from '@/lib/api/schemas';

import { useDeleteProxy } from '../hooks/use-proxy-actions';
import { hostPortOf } from '../lib/address';
import { deleteStepOf, type DeleteStep } from '../lib/delete-step';
import { sessionOfRefusal } from '../lib/refusals';
import { DeleteProxyDialog } from './delete-proxy-dialog';

export interface DeleteProxyFlowProps {
  proxy: Proxy;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Deleting one proxy, from the question to the request. It asks what the
 * table's data says is to ask; when the server knows better (a session took
 * the proxy since the table was read) it asks what the server says, once the
 * person has gone ahead: no toast for either, the dialog words them.
 *
 * Mounted from the first time a row's menu asks for it, not for every row.
 */
export function DeleteProxyFlow({
  proxy,
  open,
  onOpenChange,
}: DeleteProxyFlowProps) {
  const remove = useDeleteProxy();
  // What the backend said when it refused: it knows better than the table.
  const [refusedAs, setRefusedAs] = useState<DeleteStep | null>(null);
  const step = refusedAs ?? deleteStepOf(proxy);

  const handleOpenChange = (next: boolean) => {
    if (!next) setRefusedAs(null);
    onOpenChange(next);
  };

  const handleDelete = async () => {
    try {
      await remove.mutateAsync({
        id: proxy.id,
        force: step.kind === 'in-use',
      });
    } catch (error) {
      if (!(error instanceof ApiError)) {
        console.warn('The proxy was not deleted', error);
        return;
      }
      const session = sessionOfRefusal(error) ?? proxy.session;
      if (error.code === 'proxy_in_use') {
        setRefusedAs({ kind: 'in-use', session });
      } else if (error.code === 'proxy_busy') {
        setRefusedAs({ kind: 'busy', session });
      }
      // Any other refusal was told in a toast; the dialog stays for a retry.
      return;
    }
    handleOpenChange(false);
  };

  return (
    <DeleteProxyDialog
      open={open}
      onOpenChange={handleOpenChange}
      address={hostPortOf(proxy)}
      step={step}
      isDeleting={remove.isPending}
      onDelete={() => void handleDelete()}
    />
  );
}
