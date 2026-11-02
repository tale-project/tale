import { DeleteDialog } from '@tale/ui/dialog/delete-dialog';
import type { RefObject } from 'react';

import { ApiError } from '@/app/lib/api/client';
import type { SecretSummary } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { useSecretActions } from '../hooks/use-secret-actions';
import { useSecretLabels } from '../hooks/use-secret-labels';

interface SecretDeleteDialogProps {
  secret: SecretSummary;
  /** Called with false when the dialog is dismissed or the secret is deleted. */
  onOpenChange: (open: boolean) => void;
  /** Where the focus goes when the question is dismissed, for one asked from a menu item (gone by then). */
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

/** The question before a secret is deleted for good, naming the secret. */
export function SecretDeleteDialog({
  secret,
  onOpenChange,
  restoreFocusRef,
}: SecretDeleteDialogProps) {
  const { t } = useT('secrets');
  const labels = useSecretLabels();
  const { remove } = useSecretActions();

  const confirm = async () => {
    try {
      await remove.mutateAsync({ id: secret.id });
    } catch (error) {
      // The failure raised its toast. A secret that is already gone (deleted
      // elsewhere) leaves nothing to ask about, so the dialog goes too.
      if (error instanceof ApiError && error.code === 'secret_not_found') {
        onOpenChange(false);
      } else {
        console.warn(
          'The secret was not deleted',
          error instanceof ApiError ? error.code : error,
        );
      }
      return;
    }
    onOpenChange(false);
  };

  return (
    <DeleteDialog
      open
      onOpenChange={(open) => {
        if (!remove.isPending) onOpenChange(open);
      }}
      title={t('delete.title', { title: secret.title })}
      description={t('delete.description')}
      deleteText={t('delete.confirm')}
      preview={{
        primary: secret.title,
        secondary: labels.summary(secret),
      }}
      isDeleting={remove.isPending}
      onDelete={() => void confirm()}
      restoreFocusRef={restoreFocusRef}
    />
  );
}
