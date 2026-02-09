'use client';

import { Trash2 } from 'lucide-react';
import { useCallback } from 'react';

import { EntityDeleteDialog } from '@/app/components/ui/entity/entity-delete-dialog';
import {
  useDeleteDialog,
  useDeleteDialogTranslations,
} from '@/app/components/ui/entity/use-delete-dialog';
import { Button } from '@/app/components/ui/primitives/button';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useDeleteCustomer } from '../hooks/use-delete-customer';

interface CustomerDeleteDialogProps {
  customer: Doc<'customers'>;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  asChild?: boolean;
}

export function CustomerDeleteDialog({
  customer,
  isOpen: controlledIsOpen,
  onOpenChange: controlledOnOpenChange,
  asChild = false,
}: CustomerDeleteDialogProps) {
  const { t: tCustomers } = useT('customers');
  const { t: tToast } = useT('toast');
  const deleteCustomer = useDeleteCustomer();

  const dialog = useDeleteDialog({
    isOpen: controlledIsOpen,
    onOpenChange: controlledOnOpenChange,
  });

  const translations = useDeleteDialogTranslations({
    tEntity: tCustomers,
    tToast,
    keys: {
      title: 'deleteCustomer',
      description: 'deleteConfirmation',
      warningText: 'deleteWarning',
      errorMessage: 'deleteError',
    },
  });

  const handleDelete = useCallback(
    async (c: Doc<'customers'>) => {
      await deleteCustomer({ customerId: c._id });
    },
    [deleteCustomer],
  );

  const getEntityName = useCallback(
    (c: Doc<'customers'>) => c.name || tCustomers('thisCustomer'),
    [tCustomers],
  );

  return (
    <>
      {!asChild && (
        <Button
          variant="ghost"
          size="icon"
          onClick={dialog.open}
          aria-label={tCustomers('deleteCustomer')}
        >
          <Trash2 className="text-muted-foreground size-4" />
        </Button>
      )}

      <EntityDeleteDialog
        isOpen={dialog.isOpen}
        onClose={dialog.close}
        entity={customer}
        getEntityName={getEntityName}
        deleteMutation={handleDelete}
        translations={translations}
      />
    </>
  );
}
