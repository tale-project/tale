'use client';

import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { toast } from '@tale/ui/use-toast';
import { useCallback } from 'react';

import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';

import { useDisconnectAgent } from '../hooks/mutations';
import type { AgentConnection } from '../types';

interface DisconnectAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection: AgentConnection;
  organizationId: string;
  /** The signed-in person: the dialog speaks differently of their own agent
   * and of someone else's, which only an owner or admin may disconnect. */
  viewerUserId: string | undefined;
}

/**
 * Asks before cutting an agent off, and says what that does: it loses access
 * to this organization at once, and its person can connect it again. A
 * failure keeps the dialog open with the server's words, so the person sees
 * the agent is still connected.
 */
export function DisconnectAgentDialog({
  open,
  onOpenChange,
  connection,
  organizationId,
  viewerUserId,
}: DisconnectAgentDialogProps) {
  const { t } = useT('agentConnections');
  const { mutateAsync: disconnect, isPending } =
    useDisconnectAgent(organizationId);

  const own = connection.userId === viewerUserId;
  const person =
    connection.personName || connection.personEmail || t('list.unknownPerson');

  const handleConfirm = useCallback(() => {
    if (isPending) return;
    // Reported from the call itself, not from `mutate`'s callbacks, which
    // are dropped when the row unmounts mid-request: one failure, one toast.
    void disconnect(connection).then(
      () => {
        toast({
          title: t('disconnect.success', { client: connection.clientName }),
        });
        onOpenChange(false);
      },
      (error: unknown) => {
        console.error(error);
        toast({
          title: t('disconnect.failed', { client: connection.clientName }),
          description: failureDetail(error),
          variant: 'destructive',
        });
      },
    );
  }, [isPending, disconnect, connection, t, onOpenChange]);

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      variant="destructive"
      title={t('disconnect.title', { client: connection.clientName })}
      description={
        own
          ? t('disconnect.body', { client: connection.clientName })
          : t('disconnect.adminBody', {
              client: connection.clientName,
              person,
            })
      }
      confirmText={t('disconnect.confirm')}
      isLoading={isPending}
      onConfirm={handleConfirm}
    />
  );
}
