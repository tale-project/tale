'use client';

import { DeleteModal } from '@/components/ui/modals';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n';

interface DeleteCustomerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  customer: Doc<'customers'>;
  isDeleting?: boolean;
}

export default function DeleteCustomerDialog({
  isOpen,
  onClose,
  onConfirm,
  customer,
  isDeleting = false,
}: DeleteCustomerDialogProps) {
  const { t: tCustomers } = useT('customers');

  return (
    <DeleteModal
      open={isOpen}
      onOpenChange={() => onClose()}
      title={tCustomers('deleteCustomer')}
      description={
        <>
          {tCustomers('deleteConfirmation', {
            name: customer.name || tCustomers('thisCustomer'),
          })}
          <br />
          <br />
          {tCustomers('deleteWarning')}
        </>
      }
      isDeleting={isDeleting}
      onDelete={onConfirm}
    />
  );
}
