'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { toast } from '@/app/hooks/use-toast';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useUpdateCustomer } from '../hooks/mutations';

const CUSTOMER_STATUSES = ['active', 'churned', 'potential'] as const;
const LOCALE_PATTERN = /^[a-z]{2}(?:[-_][A-Za-z]{2,})?$/;

type CustomerFormData = {
  name: string;
  email: string;
  locale: string;
  status: (typeof CUSTOMER_STATUSES)[number];
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

  const statusOptions = useMemo(
    () =>
      CUSTOMER_STATUSES.map((s) => ({
        value: s,
        label: tGlobal(`statuses.${s}`),
      })),
    [tGlobal],
  );

  const formSchema = useMemo(
    () =>
      z.object({
        name: z.string().trim(),
        email: z.string().email(tCommon('validation.email')),
        locale: z
          .string()
          .min(
            1,
            tCommon('validation.required', { field: tCustomers('locale') }),
          )
          .regex(
            LOCALE_PATTERN,
            tCommon('validation.required', { field: tCustomers('locale') }),
          ),
        status: z.enum(CUSTOMER_STATUSES),
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
      status: customer.status || 'active',
    },
  });

  const status = watch('status');

  useEffect(() => {
    reset({
      name: customer.name || '',
      email: customer.email || '',
      locale: customer.locale || 'en',
      status: customer.status || 'active',
    });
  }, [customer, reset]);

  const onSubmit = async (data: CustomerFormData) => {
    try {
      const trimmedName = data.name.trim();
      await updateCustomer.mutateAsync({
        customerId: customer._id,
        name: trimmedName || undefined,
        email: data.email.trim(),
        locale: data.locale,
        status: data.status,
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
      isDirty={isDirty}
      onSubmit={handleSubmit(onSubmit)}
    >
      <Input
        id="name"
        label={tCustomers('name')}
        placeholder={tCustomers('namePlaceholder')}
        {...register('name')}
        disabled={isSubmitting}
        errorMessage={errors.name?.message}
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

      <Input
        id="locale"
        label={tCustomers('locale')}
        placeholder={tCustomers('localePlaceholder')}
        {...register('locale')}
        disabled={isSubmitting}
        errorMessage={errors.locale?.message}
        required
      />

      <Select
        value={status}
        onValueChange={(value: string) =>
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Select options derived from CUSTOMER_STATUSES
          setValue('status', value as (typeof CUSTOMER_STATUSES)[number], {
            shouldDirty: true,
          })
        }
        disabled={isSubmitting}
        id="status"
        label={tCustomers('status')}
        error={!!errors.status}
        options={statusOptions}
      />
    </FormDialog>
  );
}
