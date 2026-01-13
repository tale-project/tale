'use client';

import { useState, useMemo, useCallback } from 'react';
import { Eye, ScanText, RefreshCcw, Pencil, Trash2 } from 'lucide-react';
import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/components/ui/entity/entity-row-actions';
import { Doc } from '@/convex/_generated/dataModel';
import { ViewWebsiteDialog } from './website-view-dialog';
import { EditWebsiteDialog } from './website-edit-dialog';
import { DeleteWebsiteDialog } from './website-delete-dialog';
import { toast } from '@/hooks/use-toast';
import { useRescanWebsite } from '../hooks/use-rescan-website';
import { useT } from '@/lib/i18n/client';

interface WebsiteRowActionsProps {
  website: Doc<'websites'>;
}

export function WebsiteRowActions({ website }: WebsiteRowActionsProps) {
  const { t } = useT('websites');
  const { t: tCommon } = useT('common');
  const dialogs = useEntityRowDialogs(['view', 'edit', 'delete']);
  const [isRescanning, setIsRescanning] = useState(false);

  const rescanWebsite = useRescanWebsite();

  const handleRescan = useCallback(async () => {
    setIsRescanning(true);
    try {
      await rescanWebsite({ websiteId: website._id });
      toast({
        title: t('actions.rescanTriggered'),
        variant: 'success',
      });
    } catch (error) {
      toast({
        title:
          error instanceof Error ? error.message : t('actions.rescanFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsRescanning(false);
    }
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
    [tCommon, t, dialogs.open, handleRescan, isRescanning]
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
