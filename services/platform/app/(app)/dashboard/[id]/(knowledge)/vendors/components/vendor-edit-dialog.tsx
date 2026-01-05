'use client';

import { useMemo, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { FormDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Doc, Id } from '@/convex/_generated/dataModel';
import { toast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n';
import { useUpdateVendor } from '../hooks/use-update-vendor';

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

const LOCALE_CODES = ['en', 'de', 'es', 'fr', 'it', 'nl', 'pt', 'zh'] as const;

export function VendorEditDialog({
  vendor,
  isOpen,
  onOpenChange,
}: VendorEditDialogProps) {
  const { t: tVendors } = useT('vendors');
  const { t: tCommon } = useT('common');
  const { t: tGlobal } = useT('global');
  const updateVendor = useUpdateVendor();

  const localeOptions = useMemo(
    () =>
      LOCALE_CODES.map((code) => ({
        value: code,
        label: tGlobal(`languages.${code}`),
      })),
    [tGlobal],
  );

  const formSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, tCommon('validation.required', { field: tVendors('name') })),
        email: z.string().email(tCommon('validation.email')),
        locale: z.string().min(1, tCommon('validation.required', { field: tVendors('locale') })),
      }),
    [tVendors, tCommon]
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
    setValue,
    watch,
  } = useForm<VendorFormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: vendor.name || '',
      email: vendor.email || '',
      locale: vendor.locale || 'en',
    },
  });

  const locale = watch('locale');

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
        vendorId: vendor._id as Id<'vendors'>,
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
      submitDisabled={!isDirty}
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

      <Select
        value={locale}
        onValueChange={(value) => setValue('locale', value, { shouldDirty: true })}
        disabled={isSubmitting}
        id="locale"
        label={tVendors('locale')}
        error={!!errors.locale}
        options={localeOptions}
      />
    </FormDialog>
  );
}
