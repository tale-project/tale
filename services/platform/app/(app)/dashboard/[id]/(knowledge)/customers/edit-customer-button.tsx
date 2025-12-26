'use client';

import { useState, useMemo } from 'react';
import { FormModal } from '@/components/ui/modals';
import { Form } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { IconButton } from '@/components/ui/icon-button';
import { Pencil } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from '@/hooks/use-toast';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n';
import { useUpdateCustomer } from './hooks';

// Type for the form data
type EditCustomerFormValues = {
  name: string;
  email: string;
  locale: string;
};

interface EditCustomerButtonProps {
  customer: Doc<'customers'>;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  asChild?: boolean;
  triggerButton?: React.ReactNode;
}

export default function EditCustomerButton({
  customer,
  isOpen: controlledIsOpen,
  onOpenChange: controlledOnOpenChange,
  asChild = false,
  triggerButton,
}: EditCustomerButtonProps) {
  const { t: tCommon } = useT('common');
  const { t: tCustomers } = useT('customers');

  // Create Zod schema with translated validation messages
  const editCustomerSchema = useMemo(
    () =>
      z.object({
        name: z.string(),
        email: z.string().email(tCommon('validation.email')),
        locale: z.string(),
      }),
    [tCommon],
  );

  const [internalIsOpen, setInternalIsOpen] = useState(false);

  // Use controlled state if provided, otherwise use internal state
  const isOpen =
    controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;
  const setIsOpen = controlledOnOpenChange || setInternalIsOpen;
  const updateCustomer = useUpdateCustomer();

  const form = useForm<EditCustomerFormValues>({
    resolver: zodResolver(editCustomerSchema),
    defaultValues: {
      name: customer.name || '',
      email: customer.email || '',
      locale: customer.locale || 'en',
    },
  });

  const onSubmit = async (values: EditCustomerFormValues) => {
    try {
      await updateCustomer({
        customerId: customer._id,
        name: values.name,
        email: values.email,
        locale: values.locale,
      });

      toast({
        title: tCustomers('updateSuccess'),
        variant: 'success',
      });

      setIsOpen(false);
      form.reset();
    } catch (error) {
      console.error('Error updating customer:', error);
      toast({
        title: tCustomers('updateError'),
        variant: 'destructive',
      });
    }
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      form.reset();
    }
  };

  const triggerElement = !asChild ? (
    triggerButton || (
      <IconButton
        icon={Pencil}
        aria-label={tCustomers('editCustomer')}
        className="text-muted-foreground"
      />
    )
  ) : undefined;

  return (
    <FormModal
      open={isOpen}
      onOpenChange={handleOpenChange}
      title={tCustomers('editCustomer')}
      submitText={tCustomers('updateCustomer')}
      submittingText={tCommon('actions.updating')}
      isSubmitting={form.formState.isSubmitting}
      onSubmit={form.handleSubmit(onSubmit)}
      trigger={triggerElement}
    >
      <Form>
        <Input
          label={tCustomers('name')}
          placeholder={tCustomers('namePlaceholder')}
          errorMessage={form.formState.errors.name?.message}
          {...form.register('name')}
        />
        <Input
          type="email"
          label={tCustomers('email')}
          placeholder={tCustomers('emailPlaceholder')}
          errorMessage={form.formState.errors.email?.message}
          {...form.register('email')}
        />
        <Input
          label={tCustomers('locale')}
          placeholder={tCustomers('localePlaceholder')}
          errorMessage={form.formState.errors.locale?.message}
          {...form.register('locale')}
        />
      </Form>
    </FormModal>
  );
}
