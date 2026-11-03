import { Button } from '@tale/ui/button';
import { DeleteDialog } from '@tale/ui/dialog/delete-dialog';
import { Dialog } from '@tale/ui/dialog/dialog';
import { Link } from '@tanstack/react-router';

import { useT } from '@/lib/i18n/client';

import type { DeleteStep } from '../lib/delete-step';

export interface DeleteProxyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The proxy as the sentences name it. */
  address: string;
  step: DeleteStep;
  isDeleting: boolean;
  onDelete: () => void;
}

/**
 * Asks before a proxy leaves the pool, and says what it costs a session that
 * has it. A running session blocks the deletion: the dialog then says to stop
 * the session first and links to it instead of offering to delete.
 */
export function DeleteProxyDialog({
  open,
  onOpenChange,
  address,
  step,
  isDeleting,
  onDelete,
}: DeleteProxyDialogProps) {
  const { t } = useT('proxies');
  const { t: tCommon } = useT('common');
  const { t: tErrors } = useT('errors');

  // Nothing to delete, so not a delete dialog: the way out is to stop the
  // session, which this leads to. (A refresh may turn a question into this
  // while the deletion it asked for is on its way: that is let to finish.)
  if (step.kind === 'busy') {
    return (
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!isDeleting) onOpenChange(next);
        }}
        size="md"
        title={t('delete.busyTitle')}
        description={
          step.session === null
            ? tErrors('proxy_busy')
            : t('delete.busyDescription', {
                name: step.session.name,
                proxy: address,
              })
        }
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              {tCommon('actions.cancel')}
            </Button>
            {step.session !== null && (
              <Button asChild>
                <Link
                  to="/sessions/$sessionId"
                  params={{ sessionId: String(step.session.id) }}
                >
                  {t('delete.openSession')}
                </Link>
              </Button>
            )}
          </>
        }
      />
    );
  }

  // The library's delete dialog, as the platform deletes its entities
  // (`team-delete-dialog.tsx`): Cancel, then the destructive action, busy
  // until the request settles.
  return (
    <DeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        step.kind === 'in-use' ? t('delete.inUseTitle') : t('delete.title')
      }
      description={
        step.kind === 'plain'
          ? t('delete.description', { proxy: address })
          : step.session === null
            ? tErrors('proxy_in_use')
            : t('delete.inUseDescription', {
                name: step.session.name,
                proxy: address,
              })
      }
      deleteText={t('delete.confirm')}
      isDeleting={isDeleting}
      onDelete={onDelete}
    />
  );
}
