'use client';

import { Pencil, Trash2 } from 'lucide-react';
import { useMemo } from 'react';

import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/app/components/ui/entity/entity-row-actions';
import { useAbility } from '@/app/hooks/use-ability';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { VendorDeleteDialog } from './vendor-delete-dialog';
import { VendorEditDialog } from './vendor-edit-dialog';

interface VendorRowActionsProps {
  vendor: Doc<'vendors'>;
}

export function VendorRowActions({ vendor }: VendorRowActionsProps) {
  const { t: tCommon } = useT('common');
  const ability = useAbility();
  const canWrite = ability.can('write', 'knowledgeWrite');
  const dialogs = useEntityRowDialogs(['edit', 'delete']);

  const canEdit =
    canWrite &&
    (vendor.source === 'manual_import' || vendor.source === 'file_upload');

  const actions = useMemo(
    () => [
      {
        key: 'edit',
        label: tCommon('actions.edit'),
        icon: Pencil,
        onClick: dialogs.open.edit,
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
    [tCommon, dialogs.open, canEdit],
  );

  if (!canEdit) return null;

  return (
    <>
      <EntityRowActions actions={actions} />

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
