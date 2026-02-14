'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { toast } from '@/app/hooks/use-toast';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useUpdateCustomer } from '../hooks/mutations';

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

export function CustomerEditDialog({
  customer,
  isOpen,
  onOpenChange,
}: CustomerEditDialogProps) {
  const { t: tCustomers } = useT('customers');
  const { t: tCommon } = useT('common');
  const { t: tGlobal } = useT('global');
  const updateCustomer = useUpdateCustomer();

  const localeOptions = useMemo(
    () => [
      { value: 'en', label: tGlobal('languages.en') },
      { value: 'de', label: tGlobal('languages.de') },
      { value: 'es', label: tGlobal('languages.es') },
      { value: 'fr', label: tGlobal('languages.fr') },
      { value: 'it', label: tGlobal('languages.it') },
      { value: 'nl', label: tGlobal('languages.nl') },
      { value: 'pt', label: tGlobal('languages.pt') },
      { value: 'zh', label: tGlobal('languages.zh') },
    ],
    [tGlobal],
  );

  const formSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .min(
            1,
            tCommon('validation.required', { field: tCustomers('name') }),
          ),
        email: z.string().email(tCommon('validation.email')),
        locale: z
          .string()
          .min(
            1,
            tCommon('validation.required', { field: tCustomers('locale') }),
          ),
      }),
    [tCustomers, tCommon],
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
        customerId: customer._id,
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
        onValueChange={(value) =>
          setValue('locale', value, { shouldDirty: true })
        }
        disabled={isSubmitting}
        id="locale"
        label={tCustomers('locale')}
        error={!!errors.locale}
        options={localeOptions}
      />
    </FormDialog>
  );
}
