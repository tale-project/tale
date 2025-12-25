'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { FormModal } from '@/components/ui/modals';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
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
      <Button variant="ghost" size="icon" aria-label={tCustomers('editCustomer')}>
        <Pencil className="size-4 text-muted-foreground" />
      </Button>
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
      <Form {...form}>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tCustomers('name')}</FormLabel>
              <FormControl>
                <Input placeholder={tCustomers('namePlaceholder')} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tCustomers('email')}</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  placeholder={tCustomers('emailPlaceholder')}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="locale"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tCustomers('locale')}</FormLabel>
              <FormControl>
                <Input
                  placeholder={tCustomers('localePlaceholder')}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </Form>
    </FormModal>
  );
}
