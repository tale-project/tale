'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { toast } from '@/app/hooks/use-toast';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useUpdateVendor } from '../hooks/mutations';

const LOCALE_PATTERN = /^[a-z]{2}(?:[-_][A-Za-z]{2,})?$/;

type VendorFormData = {
  name: string;
  email: string;
  locale: string;
};

interface VendorEditDialogProps {
  vendor: Doc<'vendors'>;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  asChild?: boolean;
}

export function VendorEditDialog({
  vendor,
  isOpen,
  onOpenChange,
}: VendorEditDialogProps) {
  const { t: tVendors } = useT('vendors');
  const { t: tCommon } = useT('common');
  const { mutateAsync: updateVendor } = useUpdateVendor();

  const formSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(1, tCommon('validation.required', { field: tVendors('name') })),
        email: z.string().email(tCommon('validation.email')),
        locale: z
          .string()
          .min(1, tCommon('validation.required', { field: tVendors('locale') }))
          .regex(
            LOCALE_PATTERN,
            tCommon('validation.required', { field: tVendors('locale') }),
          ),
      }),
    [tVendors, tCommon],
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
  } = useForm<VendorFormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: vendor.name || '',
      email: vendor.email || '',
      locale: vendor.locale || 'en',
    },
  });

  // Reset form when vendor changes
  useEffect(() => {
    reset({
      name: vendor.name || '',
      email: vendor.email || '',
      locale: vendor.locale || 'en',
    });
  }, [vendor, reset]);

  const onSubmit = async (data: VendorFormData) => {
    try {
      await updateVendor({
        vendorId: vendor._id,
        name: data.name.trim(),
        email: data.email.trim(),
        locale: data.locale,
      });

      toast({
        title: tVendors('updateSuccess'),
        variant: 'success',
      });

      onOpenChange(false);
    } catch (error) {
      console.error('Update error:', error);
      toast({
        title: tVendors('updateError'),
        variant: 'destructive',
      });
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      reset();
    }
    onOpenChange(open);
  };

  return (
    <FormDialog
      open={isOpen}
      onOpenChange={handleOpenChange}
      title={tVendors('editVendor')}
      isSubmitting={isSubmitting}
      isDirty={isDirty}
      onSubmit={handleSubmit(onSubmit)}
    >
      <Input
        id="name"
        label={tVendors('name')}
        placeholder={tVendors('namePlaceholder')}
        {...register('name')}
        disabled={isSubmitting}
        errorMessage={errors.name?.message}
        required
      />

      <Input
        id="email"
        type="email"
        label={tVendors('email')}
        placeholder={tVendors('emailPlaceholder')}
        {...register('email')}
        disabled={isSubmitting}
        errorMessage={errors.email?.message}
        required
      />

      <Input
        id="locale"
        label={tVendors('locale')}
        placeholder={tVendors('localePlaceholder')}
        {...register('locale')}
        disabled={isSubmitting}
        errorMessage={errors.locale?.message}
        required
      />
    </FormDialog>
  );
}
