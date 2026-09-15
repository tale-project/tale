'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Input } from '@tale/ui/input';
import { Grid } from '@tale/ui/layout';
import { Select } from '@tale/ui/select';
import { Textarea } from '@tale/ui/textarea';
import { useForm } from '@tale/ui/use-form';
import { toast } from '@tale/ui/use-toast';
import { useCallback, useMemo } from 'react';
import { z } from 'zod';

import { extractErrorCode } from '@/app/features/shared/lib/extract-error-code';
import {
  isIso4217Currency,
  PRODUCT_CATEGORY_MAX,
  PRODUCT_CURRENCY_MAX,
  PRODUCT_DESCRIPTION_MAX,
  PRODUCT_IMAGE_URL_MAX,
  PRODUCT_NAME_MAX,
} from '@/backend/core/products/field_limits';
import { useT } from '@/lib/i18n/client';

import { useUpdateProduct } from '../hooks/mutations';
import { ProductImageField } from './product-image-field';

export const PRODUCT_EDIT_FORM_ID = 'product-edit';

const PRODUCT_STATUSES = ['active', 'inactive', 'draft', 'archived'] as const;

function isProductStatus(
  value: string,
): value is (typeof PRODUCT_STATUSES)[number] {
  return PRODUCT_STATUSES.some((status) => status === value);
}

export type ProductEditTarget = {
  _id: string;
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

export function productFormValues(product: ProductEditTarget): ProductFormData {
  return {
    name: product.name,
    description: product.description || '',
    imageUrl: product.imageUrl || '',
    stock: product.stock?.toString() || '',
    price: product.price?.toString() || '',
    currency: product.currency || 'USD',
    category: product.category || '',
    status:
      product.status && isProductStatus(product.status)
        ? product.status
        : 'draft',
  };
}

export function useProductEditForm(
  product: ProductEditTarget,
  onSaved: () => void,
) {
  const { t: tProducts } = useT('products');
  const { t: tCommon } = useT('common');
  const { t: tGlobal } = useT('global');
  const { mutate: updateProduct, isPending } = useUpdateProduct();

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
        currency: z
          .string()
          .trim()
          .toUpperCase()
          .refine(
            (value) => value === '' || isIso4217Currency(value),
            tProducts('edit.validation.currency'),
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
    defaultValues: productFormValues(product),
  });

  const seed = useCallback(() => {
    reset(productFormValues(product));
  }, [product, reset]);

  const submit = handleSubmit((data) => {
    updateProduct(
      {
        productId: product._id,
        name: data.name.trim(),
        description: data.description.trim() || undefined,
        imageUrl: data.imageUrl.trim() || null,
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
          onSaved();
        },
        onError: (err) => {
          console.error('Update error:', err);
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
  });

  return {
    tProducts,
    register,
    errors,
    isDirty,
    isPending,
    reset,
    seed,
    setValue,
    watch,
    statusOptions,
    submit,
  };
}

/**
 * Fields the view morph and the standalone edit overlay share. Name is
 * required (unmarked — the house Label does not paint a `*`). Everything
 * else is `required={false}` so the muted `(optional)` suffix sits
 * inline after the label. A "required fields are marked with *" legend
 * would lie: most of this form is optional.
 */
export function ProductEditFields({
  register,
  errors,
  isPending,
  setValue,
  watch,
  statusOptions,
  autoFocus = false,
}: {
  register: ReturnType<typeof useProductEditForm>['register'];
  errors: ReturnType<typeof useProductEditForm>['errors'];
  isPending: boolean;
  setValue: ReturnType<typeof useProductEditForm>['setValue'];
  watch: ReturnType<typeof useProductEditForm>['watch'];
  statusOptions: ReturnType<typeof useProductEditForm>['statusOptions'];
  autoFocus?: boolean;
}) {
  const { t: tProducts } = useT('products');
  const status = watch('status');

  return (
    <>
      <Input
        id="name"
        label={tProducts('edit.labels.name')}
        required
        {...register('name')}
        placeholder={tProducts('edit.namePlaceholder')}
        disabled={isPending}
        autoFocus={autoFocus}
        errorMessage={errors.name?.message}
      />

      <Textarea
        id="description"
        label={tProducts('edit.labels.description')}
        required={false}
        {...register('description')}
        placeholder={tProducts('edit.descriptionPlaceholder')}
        disabled={isPending}
        rows={3}
        errorMessage={errors.description?.message}
      />

      <ProductImageField
        value={watch('imageUrl')}
        onChange={(v) => setValue('imageUrl', v, { shouldDirty: true })}
        disabled={isPending}
        errorMessage={errors.imageUrl?.message}
      />

      <Grid cols={2} gap={4}>
        <Input
          id="price"
          type="number"
          step="0.01"
          min="0"
          label={tProducts('edit.labels.price')}
          required={false}
          {...register('price')}
          placeholder={tProducts('edit.pricePlaceholder')}
          disabled={isPending}
        />
        <Input
          id="currency"
          label={tProducts('edit.labels.currency')}
          required={false}
          {...register('currency')}
          placeholder={tProducts('edit.currencyPlaceholder')}
          disabled={isPending}
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
          required={false}
          {...register('stock')}
          placeholder={tProducts('edit.stockPlaceholder')}
          disabled={isPending}
        />
        <Input
          id="category"
          label={tProducts('edit.labels.category')}
          required={false}
          {...register('category')}
          placeholder={tProducts('edit.categoryPlaceholder')}
          disabled={isPending}
          maxLength={PRODUCT_CATEGORY_MAX}
          errorMessage={errors.category?.message}
        />
      </Grid>

      <Select
        value={status}
        onValueChange={(value: string) => {
          if (!isProductStatus(value)) return;
          setValue('status', value, { shouldDirty: true });
        }}
        disabled={isPending}
        id="status"
        label={tProducts('edit.labels.status')}
        error={!!errors.status}
        options={statusOptions}
      />
    </>
  );
}
