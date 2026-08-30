'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Grid } from '@tale/ui/layout';
import { useEffect, useMemo, useRef } from 'react';
import { z } from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { useForm } from '@/app/components/ui/forms/use-form';
import { extractErrorCode } from '@/app/features/shared/lib/extract-error-code';
import { toast } from '@/app/hooks/use-toast';
import {
  PRODUCT_CATEGORY_MAX,
  PRODUCT_CURRENCY_MAX,
  PRODUCT_DESCRIPTION_MAX,
  PRODUCT_IMAGE_URL_MAX,
  PRODUCT_NAME_MAX,
} from '@/convex/products/field_limits';
import { useT } from '@/lib/i18n/client';

import { useUpdateProduct } from '../hooks/mutations';
import { ProductImageField } from './product-image-field';

interface EditProductDialogProps {
  isOpen: boolean;
  onClose: () => void;
  product: {
    _id: string;
    organizationId: string;
    name: string;
    description?: string;
    imageUrl?: string;
    stock?: number;
    price?: number;
    currency?: string;
    category?: string;
    status?: (typeof PRODUCT_STATUSES)[number];
  };
}

const PRODUCT_STATUSES = ['active', 'inactive', 'draft', 'archived'] as const;

type ProductFormData = {
  name: string;
  description: string;
  imageUrl: string;
  stock: string;
  price: string;
  currency: string;
  category: string;
  status: (typeof PRODUCT_STATUSES)[number];
};

export function ProductEditDialog({
  isOpen,
  onClose,
  product,
}: EditProductDialogProps) {
  const { t: tProducts } = useT('products');
  const { t: tCommon } = useT('common');
  const { t: tGlobal } = useT('global');
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
          )
          .max(
            PRODUCT_NAME_MAX,
            tCommon('validation.maxLength', {
              field: tProducts('edit.labels.name'),
              max: PRODUCT_NAME_MAX,
            }),
          ),
        description: z.string().max(
          PRODUCT_DESCRIPTION_MAX,
          tCommon('validation.maxLength', {
            field: tProducts('edit.labels.description'),
            max: PRODUCT_DESCRIPTION_MAX,
          }),
        ),
        imageUrl: z.string().max(
          PRODUCT_IMAGE_URL_MAX,
          tCommon('validation.maxLength', {
            field: tProducts('edit.labels.imageUrl'),
            max: PRODUCT_IMAGE_URL_MAX,
          }),
        ),
        stock: z.string(),
        price: z.string(),
        currency: z.string().max(
          PRODUCT_CURRENCY_MAX,
          tCommon('validation.maxLength', {
            field: tProducts('edit.labels.currency'),
            max: PRODUCT_CURRENCY_MAX,
          }),
        ),
        category: z.string().max(
          PRODUCT_CATEGORY_MAX,
          tCommon('validation.maxLength', {
            field: tProducts('edit.labels.category'),
            max: PRODUCT_CATEGORY_MAX,
          }),
        ),
        status: z.enum(PRODUCT_STATUSES),
      }),
    [tProducts, tCommon],
  );

  const statusOptions = useMemo(
    () =>
      PRODUCT_STATUSES.map((s) => ({
        value: s,
        label: tGlobal(`statuses.${s}`),
      })),
    [tGlobal],
  );

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    setError,
    watch,
    formState: { errors, isDirty },
  } = useForm<ProductFormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: product.name,
      description: product.description || '',
      imageUrl: product.imageUrl || '',
      stock: product.stock?.toString() || '',
      price: product.price?.toString() || '',
      currency: product.currency || 'USD',
      category: product.category || '',
      status: product.status || 'draft',
    },
  });

  const status = watch('status');

  // Seed the form from the product only on the open transition. Resetting on
  // every `product` change would wipe field errors (e.g. the duplicate-name
  // error) and the user's typed name mid-edit: a duplicate rename triggers the
  // mutation's optimistic update (patches the cached product) then its rollback
  // (reverts it), and each prop-identity change would otherwise fire `reset()`.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      reset({
        name: product.name,
        description: product.description || '',
        imageUrl: product.imageUrl || '',
        stock: product.stock?.toString() || '',
        price: product.price?.toString() || '',
        currency: product.currency || 'USD',
        category: product.category || '',
        status: product.status || 'draft',
      });
    }
    wasOpen.current = isOpen;
  }, [isOpen, product, reset]);

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
        status: data.status,
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
          // Duck-typed code check — Vite chunk splitting can yield multiple
          // ConvexError copies that break `instanceof` (see extract-error-code).
          if (extractErrorCode(err) === 'DUPLICATE_PRODUCT_NAME') {
            setError('name', {
              message: tProducts('edit.toast.duplicateName'),
            });
            return;
          }
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
      isDirty={isDirty}
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
        errorMessage={errors.description?.message}
      />

      <ProductImageField
        value={watch('imageUrl')}
        onChange={(v) => setValue('imageUrl', v, { shouldDirty: true })}
        disabled={isSubmitting}
        errorMessage={errors.imageUrl?.message}
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
          maxLength={PRODUCT_CURRENCY_MAX}
          errorMessage={errors.currency?.message}
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
          maxLength={PRODUCT_CATEGORY_MAX}
          errorMessage={errors.category?.message}
        />
      </Grid>

      <Select
        value={status}
        onValueChange={(value: string) =>
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Select options derived from PRODUCT_STATUSES
          setValue('status', value as (typeof PRODUCT_STATUSES)[number], {
            shouldDirty: true,
          })
        }
        disabled={isSubmitting}
        id="status"
        label={tProducts('edit.labels.status')}
        error={!!errors.status}
        options={statusOptions}
      />
    </FormDialog>
  );
}
