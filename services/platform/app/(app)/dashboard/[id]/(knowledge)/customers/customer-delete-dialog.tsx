'use client';

import { useState, useCallback, useMemo } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Doc } from '@/convex/_generated/dataModel';
import { DeleteEntityDialog } from '@/components/ui/delete-entity-dialog';
import { useT } from '@/lib/i18n';
import { useDeleteCustomer } from './hooks';

interface DeleteCustomerButtonProps {
  customer: Doc<'customers'>;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  asChild?: boolean;
}

export default function DeleteCustomerButton({
  customer,
  isOpen: controlledIsOpen,
  onOpenChange: controlledOnOpenChange,
  asChild = false,
}: DeleteCustomerButtonProps) {
  const { t: tCustomers } = useT('customers');
  const { t: tToast } = useT('toast');
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const deleteCustomer = useDeleteCustomer();

  const isDialogOpen =
    controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;
  const setIsDialogOpen = controlledOnOpenChange || setInternalIsOpen;

  const handleDelete = useCallback(
    async (c: Doc<'customers'>) => {
      await deleteCustomer({ customerId: c._id });
    },
    [deleteCustomer]
  );

  const getEntityName = useCallback(
    (c: Doc<'customers'>) => c.name || tCustomers('thisCustomer'),
    [tCustomers]
  );

  const translations = useMemo(
    () => ({
      title: tCustomers('deleteCustomer'),
      description: tCustomers('deleteConfirmation', { name: '{name}' }),
      warningText: tCustomers('deleteWarning'),
      successMessage: tToast('success.deleted'),
      errorMessage: tCustomers('deleteError'),
    }),
    [tCustomers, tToast]
  );

  return (
    <>
      {!asChild && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsDialogOpen(true)}
          aria-label={tCustomers('deleteCustomer')}
        >
          <Trash2 className="size-4 text-muted-foreground" />
        </Button>
      )}

      <DeleteEntityDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        entity={customer}
        getEntityName={getEntityName}
        deleteMutation={handleDelete}
        translations={translations}
      />
    </>
  );
}
