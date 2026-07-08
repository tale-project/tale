'use client';

/** Delete a private (uploaded) automation's bundle (⋯ menu → confirm).
 *
 * Only offered for uploaded automations that are NOT built-in and NOT currently
 * installed — for an installed automation the ⋯ menu shows Reinstall/Uninstall
 * ({@link AutomationLifecycleActions}) instead, and the server refuses a built-in slug
 * or an active install. Removes the org's `automations/<slug>/` dir for good.
 *
 * The reusable core lives in {@link useAutomationDeleteAction} — a menu action
 * + its confirm dialog — so a caller that needs Delete alongside OTHER items
 * in ONE combined ⋯ menu (the catalog card's not-installed menu, which also
 * offers Install) can compose it instead of rendering a second, separate ⋯
 * trigger. {@link AutomationDeleteAction} is the solo-menu wrapper for call
 * sites where Delete is the automation's only row action (the pre-install
 * details page). */
import { ConvexError } from 'convex/values';
import { Trash2 } from 'lucide-react';
import { type ReactNode, useCallback, useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import {
  EntityRowActions,
  type EntityRowAction,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useDeleteAutomation } from '../hooks/upload-mutations';

interface UseAutomationDeleteActionArgs {
  automationSlug: string;
  automationName: string;
  organizationId: string;
  /** Called after a successful delete (e.g. to navigate away from the page). */
  onDeleted?: () => void;
}

/** The Delete menu item + its confirm dialog, ready to fold into any
 *  `EntityRowActions` list alongside other actions. */
export function useAutomationDeleteAction({
  automationSlug,
  automationName,
  organizationId,
  onDeleted,
}: UseAutomationDeleteActionArgs): {
  action: EntityRowAction;
  dialog: ReactNode;
  busy: boolean;
} {
  const { t } = useT('automations');
  const deleteAutomation = useDeleteAutomation();
  const dialogs = useEntityRowDialogs(['delete']);
  const [busy, setBusy] = useState(false);

  const handleDelete = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await deleteAutomation.mutateAsync({
        organizationId,
        slug: automationSlug,
      });
      toast({ title: t('upload.deleteSuccess'), variant: 'success' });
      dialogs.setOpen.delete(false);
      onDeleted?.();
    } catch (error) {
      // The server refuses while the automation is still installed — point the operator
      // at Uninstall first rather than a generic failure.
      const data = error instanceof ConvexError ? error.data : undefined;
      const code =
        data && typeof data === 'object' && 'code' in data
          ? data.code
          : undefined;
      toast({
        title:
          code === 'AUTOMATION_INSTALLED'
            ? t('upload.deleteInstalledBlocked')
            : t('upload.deleteFailed'),
        variant: 'destructive',
      });
      if (code !== 'AUTOMATION_INSTALLED') console.error(error);
      dialogs.setOpen.delete(false);
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    deleteAutomation,
    organizationId,
    automationSlug,
    t,
    dialogs,
    onDeleted,
  ]);

  return {
    action: {
      key: 'delete',
      label: t('upload.delete'),
      icon: Trash2,
      destructive: true,
      disabled: busy,
      onClick: () => dialogs.open.delete(),
    },
    dialog: (
      <DeleteDialog
        open={dialogs.isOpen.delete}
        onOpenChange={dialogs.setOpen.delete}
        title={t('upload.deleteTitle')}
        description={t('upload.deleteDescription')}
        preview={{ primary: automationName }}
        warning={t('upload.deleteWarning')}
        deleteText={t('upload.delete')}
        isDeleting={busy}
        onDelete={() => void handleDelete()}
      />
    ),
    busy,
  };
}

interface AutomationDeleteActionProps {
  automationSlug: string;
  automationName: string;
  organizationId: string;
  /** Extra classes for the ⋯ trigger (e.g. card overlay positioning). */
  triggerClassName?: string;
  /** Called after a successful delete (e.g. to navigate away from the page). */
  onDeleted?: () => void;
}

export function AutomationDeleteAction({
  automationSlug,
  automationName,
  organizationId,
  triggerClassName,
  onDeleted,
}: AutomationDeleteActionProps) {
  const { t } = useT('automations');
  const { action, dialog, busy } = useAutomationDeleteAction({
    automationSlug,
    automationName,
    organizationId,
    onDeleted,
  });

  return (
    <>
      <EntityRowActions
        actions={[action]}
        ariaLabel={t('upload.deleteMenuLabel', { name: automationName })}
        triggerClassName={triggerClassName}
        disabled={busy}
      />

      {dialog}
    </>
  );
}
