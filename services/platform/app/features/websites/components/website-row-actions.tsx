'use client';

import { Eye, ScanText, RefreshCcw, Pencil, Trash2 } from 'lucide-react';
import { useMemo, useCallback } from 'react';

import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { toast } from '@/app/hooks/use-toast';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useRescanWebsite } from '../hooks/mutations';
import { DeleteWebsiteDialog } from './website-delete-dialog';
import { EditWebsiteDialog } from './website-edit-dialog';
import { ViewWebsiteDialog } from './website-view-dialog';

interface WebsiteRowActionsProps {
  website: Doc<'websites'>;
}

export function WebsiteRowActions({ website }: WebsiteRowActionsProps) {
  const { t } = useT('websites');
  const { t: tCommon } = useT('common');
  const dialogs = useEntityRowDialogs(['view', 'edit', 'delete']);

  const { mutate: rescanWebsite, isPending: isRescanning } = useRescanWebsite();

  const handleRescan = useCallback(() => {
    rescanWebsite(
      { websiteId: website._id },
      {
        onSuccess: () => {
          toast({
            title: t('actions.rescanTriggered'),
            variant: 'success',
          });
        },
        onError: (error) => {
          console.error('Failed to rescan website:', error);
          toast({
            title: t('actions.rescanFailed'),
            variant: 'destructive',
          });
        },
      },
    );
  }, [rescanWebsite, website._id, t]);

  const actions = useMemo(
    () => [
      {
        key: 'view',
        label: tCommon('actions.view'),
        icon: Eye,
        onClick: dialogs.open.view,
      },
      {
        key: 'rescan',
        label: t('actions.rescan'),
        icon: isRescanning ? RefreshCcw : ScanText,
        onClick: handleRescan,
        disabled: isRescanning,
      },
      {
        key: 'edit',
        label: tCommon('actions.edit'),
        icon: Pencil,
        onClick: dialogs.open.edit,
      },
      {
        key: 'delete',
        label: tCommon('actions.delete'),
        icon: Trash2,
        onClick: dialogs.open.delete,
        destructive: true,
      },
    ],
    [tCommon, t, dialogs.open, handleRescan, isRescanning],
  );

  return (
    <>
      <EntityRowActions actions={actions} />

      {dialogs.isOpen.view && (
        <ViewWebsiteDialog
          isOpen={dialogs.isOpen.view}
          onClose={() => dialogs.setOpen.view(false)}
          website={website}
        />
      )}

      {dialogs.isOpen.edit && (
        <EditWebsiteDialog
          isOpen={dialogs.isOpen.edit}
          onClose={() => dialogs.setOpen.edit(false)}
          website={website}
        />
      )}

      {dialogs.isOpen.delete && (
        <DeleteWebsiteDialog
          isOpen={dialogs.isOpen.delete}
          onClose={() => dialogs.setOpen.delete(false)}
          website={website}
        />
      )}
    </>
  );
}
