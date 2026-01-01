'use client';

import { useMemo } from 'react';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import {
  EntityRowActions,
  useEntityRowDialogs,
} from '@/components/ui/entity-row-actions';
import { CustomerInfoDialog } from '@/components/email-table/customer-info-dialog';
import { CustomerEditDialog } from './customer-edit-dialog';
import { CustomerDeleteDialog } from './customer-delete-dialog';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n';

interface CustomerRowActionsProps {
  customer: Doc<'customers'>;
}

export function CustomerRowActions({
  customer,
}: CustomerRowActionsProps) {
  const { t: tCommon } = useT('common');
  const { t: tCustomers } = useT('customers');
  const dialogs = useEntityRowDialogs(['view', 'edit', 'delete']);

  const canEdit =
    customer.source === 'manual_import' || customer.source === 'file_upload';

  const actions = useMemo(
    () => [
      {
        key: 'view',
        label: tCustomers('viewDetails'),
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
    [tCustomers, tCommon, dialogs.open, canEdit]
  );

  return (
    <>
      <EntityRowActions actions={actions} />

      <CustomerInfoDialog
        customer={customer}
        open={dialogs.isOpen.view}
        onOpenChange={dialogs.setOpen.view}
      />

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
