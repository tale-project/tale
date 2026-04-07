'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Grid } from '@/app/components/ui/layout/layout';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  PRODUCT_STATUS,
  type ProductStatus,
} from '@/lib/shared/constants/convex-enums';

import { useCreateProduct } from '../hooks/mutations';

function isProductStatus(value: string): value is ProductStatus {
  return (Object.values(PRODUCT_STATUS) as string[]).includes(value);
}

type ProductFormData = {
  name: string;
  description: string;
  imageUrl: string;
  stock: string;
  price: string;
  currency: string;
  category: string;
  status: string;
};

interface ProductCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
}

export function ProductCreateDialog({
  isOpen,
  onClose,
  organizationId,
}: ProductCreateDialogProps) {
  const { t: tProducts } = useT('products');
  const { t: tCommon } = useT('common');
  const { mutate: createProduct, isPending: isSubmitting } = useCreateProduct();

  const statusOptions = useMemo(
    () =>
      Object.values(PRODUCT_STATUS).map((value) => ({
        value,
        label: tCommon(`status.${value}`),
      })),
    [tCommon],
  );

  const formSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(
            1,
            tCommon('validation.required', {
              field: tProducts('edit.labels.name'),
            }),
          ),
        description: z.string(),
        imageUrl: z.string(),
        stock: z.string(),
        price: z.string(),
        currency: z.string(),
        category: z.string(),
        status: z.string(),
      }),
    [tProducts, tCommon],
  );

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ProductFormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      description: '',
      imageUrl: '',
      stock: '',
      price: '',
      currency: 'USD',
      category: '',
      status: PRODUCT_STATUS.Draft,
    },
  });

  const status = watch('status');

  const handleClose = () => {
    reset();
    onClose();
  };

  const onSubmit = (data: ProductFormData) => {
    const statusValue = data.status || undefined;
    createProduct(
      {
        organizationId,
        name: data.name.trim(),
        description: data.description.trim() || undefined,
        imageUrl: data.imageUrl.trim() || undefined,
        stock: data.stock ? parseInt(data.stock) : undefined,
        price: data.price ? parseFloat(data.price) : undefined,
        currency: data.currency || undefined,
        category: data.category.trim() || undefined,
        status:
          statusValue && isProductStatus(statusValue) ? statusValue : undefined,
      },
      {
        onSuccess: () => {
          toast({
            title: tProducts('create.toast.success'),
            variant: 'success',
          });
          handleClose();
        },
        onError: (err) => {
          console.error('Create error:', err);
          toast({
            title: tProducts('create.toast.error'),
            variant: 'destructive',
          });
        },
      },
    );
  };

  return (
    <FormDialog
      open={isOpen}
      onOpenChange={(open) => !open && handleClose()}
      title={tProducts('create.title')}
      description={tProducts('create.description')}
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit(onSubmit)}
      large
    >
      <Input
        id="name"
        label={tProducts('edit.labels.name')}
        required
        {...register('name')}
        placeholder={tProducts('edit.namePlaceholder')}
        disabled={isSubmitting}
        errorMessage={errors.name?.message}
      />

      <Textarea
        id="description"
        label={tProducts('edit.labels.description')}
        {...register('description')}
        placeholder={tProducts('edit.descriptionPlaceholder')}
        disabled={isSubmitting}
        rows={3}
      />

      <Input
        id="imageUrl"
        type="url"
        label={tProducts('edit.labels.imageUrl')}
        {...register('imageUrl')}
        placeholder={tProducts('edit.imageUrlPlaceholder')}
        disabled={isSubmitting}
      />

      <Grid cols={2} gap={4}>
        <Input
          id="price"
          type="number"
          step="0.01"
          min="0"
          label={tProducts('edit.labels.price')}
          {...register('price')}
          placeholder={tProducts('edit.pricePlaceholder')}
          disabled={isSubmitting}
        />
        <Input
          id="currency"
          label={tProducts('edit.labels.currency')}
          {...register('currency')}
          placeholder={tProducts('edit.currencyPlaceholder')}
          disabled={isSubmitting}
          maxLength={3}
        />
      </Grid>

      <Grid cols={2} gap={4}>
        <Input
          id="stock"
          type="number"
          min="0"
          label={tProducts('edit.labels.stock')}
          {...register('stock')}
          placeholder={tProducts('edit.stockPlaceholder')}
          disabled={isSubmitting}
        />
        <Input
          id="category"
          label={tProducts('edit.labels.category')}
          {...register('category')}
          placeholder={tProducts('edit.categoryPlaceholder')}
          disabled={isSubmitting}
        />
      </Grid>

      <Select
        id="status"
        label={tProducts('create.labels.status')}
        value={status}
        onValueChange={(value) =>
          setValue('status', value, { shouldDirty: true })
        }
        disabled={isSubmitting}
        options={statusOptions}
      />
    </FormDialog>
  );
}
