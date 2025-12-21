'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { Doc } from '@/convex/_generated/dataModel';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import DeleteCustomerDialog from './delete-customer-dialog';

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
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const deleteCustomer = useMutation(api.customers.deleteCustomer);

  // Use controlled state if provided, otherwise use internal state
  const isDialogOpen =
    controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;
  const setIsDialogOpen = controlledOnOpenChange || setInternalIsOpen;

  const handleDeleteCustomer = async () => {
    try {
      setIsDeleting(true);

      await deleteCustomer({
        customerId: customer._id,
      });

      setIsDialogOpen(false);
    } catch (err) {
      console.error('Deletion error:', err);
      toast({
        title: 'An error occurred while deleting the customer',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      {!asChild && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsDialogOpen(true)}
          title="Delete customer"
        >
          <Trash2 className="size-4 text-muted-foreground" />
        </Button>
      )}

      <DeleteCustomerDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onConfirm={handleDeleteCustomer}
        customer={customer}
        isDeleting={isDeleting}
      />
    </>
  );
}
