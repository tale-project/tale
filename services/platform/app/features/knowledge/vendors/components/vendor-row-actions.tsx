'use client';

import { useMemo } from 'react';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { VendorInfoDialog } from './vendor-info-dialog';
import { VendorEditDialog } from './vendor-edit-dialog';
import { VendorDeleteDialog } from './vendor-delete-dialog';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

interface VendorRowActionsProps {
  vendor: Doc<'vendors'>;
}

export function VendorRowActions({ vendor }: VendorRowActionsProps) {
  const { t } = useT('vendors');
  const { t: tCommon } = useT('common');
  const dialogs = useEntityRowDialogs(['view', 'edit', 'delete']);

  const canEdit =
    vendor.source === 'manual_import' || vendor.source === 'file_upload';

  const actions = useMemo(
    () => [
      {
        key: 'view',
        label: t('viewDetails'),
        icon: Eye,
        onClick: dialogs.open.view,
      },
      {
        key: 'edit',
        label: tCommon('actions.edit'),
        icon: Pencil,
        onClick: dialogs.open.edit,
        separator: true,
        visible: canEdit,
      },
      {
        key: 'delete',
        label: tCommon('actions.delete'),
        icon: Trash2,
        onClick: dialogs.open.delete,
        destructive: true,
        visible: canEdit,
      },
    ],
    [t, tCommon, dialogs.open, canEdit]
  );

  return (
    <>
      <EntityRowActions actions={actions} />

      <VendorInfoDialog
        vendor={vendor}
        open={dialogs.isOpen.view}
        onOpenChange={dialogs.setOpen.view}
      />

      <VendorEditDialog
        vendor={vendor}
        isOpen={dialogs.isOpen.edit}
        onOpenChange={dialogs.setOpen.edit}
        asChild
      />

      <VendorDeleteDialog
        vendor={vendor}
        isOpen={dialogs.isOpen.delete}
        onOpenChange={dialogs.setOpen.delete}
        asChild
      />
    </>
  );
}
