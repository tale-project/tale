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
import { useUpdateCustomer } from './hooks';

type CustomerFormData = {
  name: string;
  email: string;
  locale: string;
};

interface CustomerEditDialogProps {
  customer: Doc<'customers'>;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  asChild?: boolean;
}

const LOCALE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'it', label: 'Italiano' },
  { value: 'nl', label: 'Nederlands' },
  { value: 'pt', label: 'Português' },
  { value: 'zh', label: '中文' },
];

export default function CustomerEditDialog({
  customer,
  isOpen,
  onOpenChange,
}: CustomerEditDialogProps) {
  const { t: tCustomers } = useT('customers');
  const { t: tCommon } = useT('common');
  const updateCustomer = useUpdateCustomer();

  const formSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, tCommon('validation.required', { field: tCustomers('name') })),
        email: z.string().email(tCommon('validation.email')),
        locale: z.string().min(1, tCommon('validation.required', { field: tCustomers('locale') })),
      }),
    [tCustomers, tCommon]
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
    setValue,
    watch,
  } = useForm<CustomerFormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: customer.name || '',
      email: customer.email || '',
      locale: customer.locale || 'en',
    },
  });

  const locale = watch('locale');

  // Reset form when customer changes
  useEffect(() => {
    reset({
      name: customer.name || '',
      email: customer.email || '',
      locale: customer.locale || 'en',
    });
  }, [customer, reset]);

  const onSubmit = async (data: CustomerFormData) => {
    try {
      await updateCustomer({
        customerId: customer._id as Id<'customers'>,
        name: data.name.trim(),
        email: data.email.trim(),
        locale: data.locale,
      });

      toast({
        title: tCustomers('updateSuccess'),
        variant: 'success',
      });

      onOpenChange(false);
    } catch (error) {
      console.error('Update error:', error);
      toast({
        title: tCustomers('updateError'),
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
      title={tCustomers('editCustomer')}
      isSubmitting={isSubmitting}
      submitDisabled={!isDirty}
      onSubmit={handleSubmit(onSubmit)}
    >
      <Input
        id="name"
        label={tCustomers('name')}
        placeholder={tCustomers('namePlaceholder')}
        {...register('name')}
        disabled={isSubmitting}
        errorMessage={errors.name?.message}
        required
      />

      <Input
        id="email"
        type="email"
        label={tCustomers('email')}
        placeholder={tCustomers('emailPlaceholder')}
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
        label={tCustomers('locale')}
        error={!!errors.locale}
        options={LOCALE_OPTIONS}
      />
    </FormDialog>
  );
}
