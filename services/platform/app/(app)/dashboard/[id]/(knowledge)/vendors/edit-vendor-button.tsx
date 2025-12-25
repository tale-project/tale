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
import { useUpdateVendor } from './hooks';

// Type for the form data
type EditVendorFormValues = {
  name: string;
  email: string;
  locale: string;
};

interface EditVendorButtonProps {
  vendor: Doc<'vendors'>;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  asChild?: boolean;
  triggerButton?: React.ReactNode;
}

export default function EditVendorButton({
  vendor,
  isOpen: controlledIsOpen,
  onOpenChange: controlledOnOpenChange,
  asChild = false,
  triggerButton,
}: EditVendorButtonProps) {
  const { t: tCommon } = useT('common');
  const { t: tVendors } = useT('vendors');

  // Create Zod schema with translated validation messages
  const editVendorSchema = useMemo(
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
  const updateVendor = useUpdateVendor();

  const form = useForm<EditVendorFormValues>({
    resolver: zodResolver(editVendorSchema),
    defaultValues: {
      name: vendor.name || '',
      email: vendor.email || '',
      locale: vendor.locale || 'en',
    },
  });

  const onSubmit = async (values: EditVendorFormValues) => {
    try {
      await updateVendor({
        vendorId: vendor._id,
        name: values.name,
        email: values.email,
        locale: values.locale,
      });

      toast({
        title: tVendors('updateSuccess'),
        variant: 'success',
      });

      setIsOpen(false);
      form.reset();
    } catch (error) {
      console.error('Error updating vendor:', error);
      toast({
        title: tVendors('updateError'),
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
      <Button
        variant="ghost"
        size="icon"
        aria-label={tVendors('editVendor')}
        className="hover:bg-transparent"
      >
        <Pencil className="size-4" />
      </Button>
    )
  ) : undefined;

  return (
    <FormModal
      open={isOpen}
      onOpenChange={handleOpenChange}
      title={tVendors('editVendor')}
      submitText={tVendors('updateVendor')}
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
              <FormLabel>{tVendors('name')}</FormLabel>
              <FormControl>
                <Input placeholder={tVendors('namePlaceholder')} {...field} />
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
              <FormLabel>{tVendors('email')}</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  placeholder={tVendors('emailPlaceholder')}
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
              <FormLabel>{tVendors('locale')}</FormLabel>
              <FormControl>
                <Input
                  placeholder={tVendors('localePlaceholder')}
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
