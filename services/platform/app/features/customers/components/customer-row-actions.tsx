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

import { CustomerDeleteDialog } from './customer-delete-dialog';
import { CustomerEditDialog } from './customer-edit-dialog';

interface CustomerRowActionsProps {
  customer: Doc<'customers'>;
}

export function CustomerRowActions({ customer }: CustomerRowActionsProps) {
  const { t: tCommon } = useT('common');
  const ability = useAbility();
  const canWrite = ability.can('write', 'knowledgeWrite');
  const dialogs = useEntityRowDialogs(['edit', 'delete']);

  const canEdit =
    canWrite &&
    (customer.source === 'manual_import' || customer.source === 'file_upload');

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

      <CustomerEditDialog
        customer={customer}
        isOpen={dialogs.isOpen.edit}
        onOpenChange={dialogs.setOpen.edit}
        asChild
      />

      <CustomerDeleteDialog
        customer={customer}
        isOpen={dialogs.isOpen.delete}
        onOpenChange={dialogs.setOpen.delete}
        asChild
      />
    </>
  );
}
