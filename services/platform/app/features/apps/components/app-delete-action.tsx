'use client';

/** Delete a private (uploaded) app's bundle (⋯ menu → confirm).
 *
 * Only offered for uploaded apps that are NOT built-in and NOT currently
 * installed — for an installed app the ⋯ menu shows Reinstall/Uninstall
 * ({@link AppLifecycleActions}) instead, and the server refuses a built-in slug
 * or an active install. Removes the org's `apps/<slug>/` dir for good. */
import { ConvexError } from 'convex/values';
import { Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';

import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useDeleteApp } from '../hooks/upload-mutations';

interface AppDeleteActionProps {
  appSlug: string;
  appName: string;
  organizationId: string;
  /** Extra classes for the ⋯ trigger (e.g. card overlay positioning). */
  triggerClassName?: string;
  /** Called after a successful delete (e.g. to navigate away from the page). */
  onDeleted?: () => void;
}

export function AppDeleteAction({
  appSlug,
  appName,
  organizationId,
  triggerClassName,
  onDeleted,
}: AppDeleteActionProps) {
  const { t } = useT('apps');
  const deleteApp = useDeleteApp();
  const dialogs = useEntityRowDialogs(['delete']);
  const [busy, setBusy] = useState(false);

  const handleDelete = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await deleteApp.mutateAsync({ organizationId, slug: appSlug });
      toast({ title: t('upload.deleteSuccess'), variant: 'success' });
      dialogs.setOpen.delete(false);
      onDeleted?.();
    } catch (error) {
      // The server refuses while the app is still installed — point the operator
      // at Uninstall first rather than a generic failure.
      const data = error instanceof ConvexError ? error.data : undefined;
      const code =
        data && typeof data === 'object' && 'code' in data
          ? data.code
          : undefined;
      toast({
        title:
          code === 'APP_INSTALLED'
            ? t('upload.deleteInstalledBlocked')
            : t('upload.deleteFailed'),
        variant: 'destructive',
      });
      if (code !== 'APP_INSTALLED') console.error(error);
      dialogs.setOpen.delete(false);
    } finally {
      setBusy(false);
    }
  }, [busy, deleteApp, organizationId, appSlug, t, dialogs, onDeleted]);

  return (
    <>
      <EntityRowActions
        actions={[
          {
            key: 'delete',
            label: t('upload.delete'),
            icon: Trash2,
            destructive: true,
            onClick: () => dialogs.open.delete(),
          },
        ]}
        ariaLabel={t('upload.deleteMenuLabel', { name: appName })}
        triggerClassName={triggerClassName}
        disabled={busy}
      />

      <DeleteDialog
        open={dialogs.isOpen.delete}
        onOpenChange={dialogs.setOpen.delete}
        title={t('upload.deleteTitle')}
        description={t('upload.deleteDescription')}
        preview={{ primary: appName }}
        warning={t('upload.deleteWarning')}
        deleteText={t('upload.delete')}
        isDeleting={busy}
        onDelete={() => void handleDelete()}
      />
    </>
  );
}
