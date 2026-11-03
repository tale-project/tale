import { DeleteDialog } from '@tale/ui/dialog/delete-dialog';
import { Text } from '@tale/ui/text';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useQuoted } from '@/app/hooks/use-quoted';
import { secretsApi } from '@/app/lib/api/endpoints';
import { queryKeys } from '@/app/lib/api/keys';
import type { Session } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { useSessionActions } from '../hooks/use-session-actions';
import { readSecretsOfSession } from '../lib/removal';
import { settle } from '../lib/settle';

interface DeleteSessionDialogProps {
  session: Session;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The session is gone. */
  onDeleted?: (() => void) | undefined;
}

/**
 * Asks before deleting a session, and says what goes with it: its browser
 * profile (cookies, storage, history) and its own secrets, which it counts. A
 * running session's browser is closed first.
 */
export function DeleteSessionDialog({
  session,
  open,
  onOpenChange,
  onDeleted,
}: DeleteSessionDialogProps) {
  const { t } = useT('sessions');
  const { quoted } = useQuoted();
  const queryClient = useQueryClient();
  const { remove } = useSessionActions();
  const scope = String(session.id);
  // The secrets of this session alone, not those for every session. Once the
  // deletion is under way the count read before stands: its secrets go with
  // the session, and asking for them again could only be refused.
  const secrets = useQuery({
    queryKey: queryKeys.secretList({ scope }),
    queryFn: ({ signal }) =>
      readSecretsOfSession(queryClient, session.id, () =>
        secretsApi.list({ scope }, { signal }),
      ),
  });
  const own = secrets.data?.length ?? 0;
  const closesBrowser =
    session.status !== 'stopped' && session.status !== 'error';

  const confirm = async () => {
    const result = await settle(remove.mutateAsync({ id: session.id }));
    if (!result.ok) return;
    onOpenChange(false);
    onDeleted?.();
  };

  return (
    <DeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('delete.title', { name: quoted(session.name) })}
      description={
        closesBrowser
          ? t('delete.descriptionBrowserOpen')
          : t('delete.description')
      }
      deleteText={t('delete.confirm')}
      isDeleting={remove.isPending}
      // The count is part of what the person agrees to.
      disableDelete={secrets.isPending}
      onDelete={() => void confirm()}
    >
      {own > 0 && (
        <Text variant="label">{t('delete.secrets', { count: own })}</Text>
      )}
    </DeleteDialog>
  );
}
