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
      <IconButton
        icon={Pencil}
        aria-label={tVendors('editVendor')}
        className="hover:bg-transparent"
      />
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
      <Form>
        <Input
          label={tVendors('name')}
          placeholder={tVendors('namePlaceholder')}
          errorMessage={form.formState.errors.name?.message}
          {...form.register('name')}
        />
        <Input
          type="email"
          label={tVendors('email')}
          placeholder={tVendors('emailPlaceholder')}
          errorMessage={form.formState.errors.email?.message}
          {...form.register('email')}
        />
        <Input
          label={tVendors('locale')}
          placeholder={tVendors('localePlaceholder')}
          errorMessage={form.formState.errors.locale?.message}
          {...form.register('locale')}
        />
      </Form>
    </FormModal>
  );
}
