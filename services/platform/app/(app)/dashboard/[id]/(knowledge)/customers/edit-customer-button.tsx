'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { toast } from '@/hooks/use-toast';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n';

const editCustomerSchema = z.object({
  name: z.string(),
  email: z.string().email('Invalid email address'),
  locale: z.string(),
});

type EditCustomerFormValues = z.infer<typeof editCustomerSchema>;

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
  const [internalIsOpen, setInternalIsOpen] = useState(false);

  // Use controlled state if provided, otherwise use internal state
  const isOpen =
    controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;
  const setIsOpen = controlledOnOpenChange || setInternalIsOpen;
  const updateCustomer = useMutation(api.customers.updateCustomer);

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

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      {!asChild && (
        <DialogTrigger asChild>
          {triggerButton || (
            <Button variant="ghost" size="icon" title={tCustomers('editCustomer')}>
              <Pencil className="size-4 text-muted-foreground" />
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader className="py-2">
          <DialogTitle>{tCustomers('editCustomer')}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
            <div className="flex justify-end space-x-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsOpen(false)}
              >
                {tCommon('actions.cancel')}
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting
                  ? tCommon('actions.updating')
                  : tCustomers('updateCustomer')}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
