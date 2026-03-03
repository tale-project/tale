'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Grid } from '@/app/components/ui/layout/layout';
import { toast } from '@/app/hooks/use-toast';
import { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useUpdateProduct } from '../hooks/mutations';

interface EditProductDialogProps {
  isOpen: boolean;
  onClose: () => void;
  product: {
    _id: Id<'products'>;
    organizationId: string;
    name: string;
    description?: string;
    imageUrl?: string;
    stock?: number;
    price?: number;
    currency?: string;
    category?: string;
    status?: string;
  };
}

type ProductFormData = {
  name: string;
  description: string;
  imageUrl: string;
  stock: string;
  price: string;
  currency: string;
  category: string;
};

export function ProductEditDialog({
  isOpen,
  onClose,
  product,
}: EditProductDialogProps) {
  const { t: tProducts } = useT('products');
  const { t: tCommon } = useT('common');
  const { mutate: updateProduct, isPending: isSubmitting } = useUpdateProduct();

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
      }),
    [tProducts, tCommon],
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { isValid, errors },
  } = useForm<ProductFormData>({
    resolver: zodResolver(formSchema),
    mode: 'onChange',
    defaultValues: {
      name: product.name,
      description: product.description || '',
      imageUrl: product.imageUrl || '',
      stock: product.stock?.toString() || '',
      price: product.price?.toString() || '',
      currency: product.currency || 'USD',
      category: product.category || '',
    },
  });

  useEffect(() => {
    reset({
      name: product.name,
      description: product.description || '',
      imageUrl: product.imageUrl || '',
      stock: product.stock?.toString() || '',
      price: product.price?.toString() || '',
      currency: product.currency || 'USD',
      category: product.category || '',
    });
  }, [product, reset]);

  const onSubmit = (data: ProductFormData) => {
    updateProduct(
      {
        productId: product._id,
        name: data.name.trim(),
        description: data.description.trim() || undefined,
        imageUrl: data.imageUrl.trim() || undefined,
        stock: data.stock ? parseInt(data.stock) : undefined,
        price: data.price ? parseFloat(data.price) : undefined,
        currency: data.currency || undefined,
        category: data.category.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast({
            title: tProducts('edit.toast.success'),
            variant: 'success',
          });
          onClose();
        },
        onError: (err) => {
          console.error('Update error:', err);
          toast({
            title: tProducts('edit.toast.error'),
            variant: 'destructive',
          });
        },
      },
    );
  };

  return (
    <FormDialog
      open={isOpen}
      onOpenChange={onClose}
      title={tProducts('edit.title')}
      description={tProducts('edit.description')}
      isSubmitting={isSubmitting}
      isValid={isValid}
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
    </FormDialog>
  );
}
