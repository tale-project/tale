'use client';

import { DeleteDialog } from '@tale/ui/dialog/delete-dialog';
import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@tale/ui/entity/entity-row-actions';
import { toast } from '@tale/ui/use-toast';
import { History, Trash2 } from 'lucide-react';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

import { useDeleteAutomation } from '../hooks/mutations';
import { automationErrorMessage } from '../lib/errors';

interface AutomationRowActionsProps {
  organizationId: string;
  name: string;
  displayName: string;
  /** Opens the automation's Versions tab. */
  onOpenVersions: () => void;
}

/**
 * The list-row overflow: the version history, and delete, with the confirm
 * that used to sit on the editor. Opening the canvas is the row itself;
 * destroying the automation is a catalog act, so it lives here rather than
 * beside Save / Test run.
 */
export function AutomationRowActions({
  organizationId,
  name,
  displayName,
  onOpenVersions,
}: AutomationRowActionsProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const dialogs = useEntityRowDialogs(['delete']);
  const deleteAutomation = useDeleteAutomation();

  const actions = useMemo(
    () => [
      {
        key: 'versions',
        label: t('versions.actions.history'),
        icon: History,
        onClick: onOpenVersions,
      },
      {
        key: 'delete',
        label: tCommon('actions.delete'),
        icon: Trash2,
        destructive: true,
        separator: true,
        onClick: () => dialogs.open.delete(),
      },
    ],
    [t, tCommon, dialogs.open, onOpenVersions],
  );

  return (
    <>
      <EntityRowActions actions={actions} />

      {/* Mounted from its first open: every row of the list carries it. */}
      {dialogs.mounted.delete && (
        <DeleteDialog
          open={dialogs.isOpen.delete}
          onOpenChange={(open) => {
            if (!deleteAutomation.isPending) dialogs.setOpen.delete(open);
          }}
          title={t('detail.delete.title')}
          description={t('detail.delete.description', { name: displayName })}
          isDeleting={deleteAutomation.isPending}
          onDelete={() => {
            void (async () => {
              try {
                await deleteAutomation.mutateAsync({
                  organizationId,
                  name,
                });
                dialogs.setOpen.delete(false);
                toast({ title: t('detail.delete.done'), variant: 'success' });
              } catch (error) {
                dialogs.setOpen.delete(false);
                toast({
                  title: t('detail.delete.failed'),
                  description: automationErrorMessage(error),
                  variant: 'destructive',
                });
              }
            })();
          }}
        />
      )}
    </>
  );
}
