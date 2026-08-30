'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Grid, Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useMemo, useState } from 'react';
import { z } from 'zod';

import { Image } from '@/app/components/ui/data-display/image';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { useForm } from '@/app/components/ui/forms/use-form';
import { type WizardStepMeta } from '@/app/components/ui/wizard/use-wizard';
import { Wizard, WizardStep } from '@/app/components/ui/wizard/wizard';
import { WizardFooter } from '@/app/components/ui/wizard/wizard-footer';
import { WizardProgress } from '@/app/components/ui/wizard/wizard-progress';
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
import {
  PRODUCT_STATUS,
  type ProductStatus,
} from '@/lib/shared/constants/convex-enums';

import { useCreateProduct } from '../hooks/mutations';
import { ProductImageField } from './product-image-field';

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

/** One label/value row in the review step. Hides empty values. */
function ReviewRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <Row align="stretch" justify="between" className="py-1">
      <Text variant="muted" className="shrink-0">
        {label}
      </Text>
      <Text className="min-w-0 truncate text-right">{value}</Text>
    </Row>
  );
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

  const values = watch();
  const status = values.status;
  const nameValid = values.name.trim().length > 0;

  const [activeIndex, setActiveIndex] = useState(0);

  const handleClose = () => {
    reset();
    setActiveIndex(0);
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
          // Duck-typed code check — Vite chunk splitting can yield multiple
          // BackendError copies that break `instanceof` (see extract-error-code).
          const isDuplicate =
            extractErrorCode(err) === 'DUPLICATE_PRODUCT_NAME';
          toast({
            title: isDuplicate
              ? tProducts('create.toast.duplicateName')
              : tProducts('create.toast.error'),
            variant: 'destructive',
          });
        },
      },
    );
  };

  const steps: WizardStepMeta[] = [
    { id: 'basics', label: tProducts('createWizard.steps.basics') },
    { id: 'pricing', label: tProducts('createWizard.steps.pricing') },
    { id: 'review', label: tProducts('createWizard.steps.review') },
  ];

  const stepHints = [
    tProducts('createWizard.basicsHint'),
    tProducts('createWizard.pricingHint'),
    tProducts('createWizard.reviewHint'),
  ];

  // Options are labelled `status.<value>`; derive the current label the same
  // way to avoid an enum-vs-string comparison on the form's string value.
  const statusLabel = status ? tCommon(`status.${status}`) : status;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => !open && handleClose()}
      title={tProducts('create.title')}
      description={stepHints[activeIndex]}
      size="md"
    >
      {/* Keyed on open so each fresh open starts at step 1 (form reset lives in
          handleClose). Remounts only the wizard subtree, not the dialog. */}
      <Wizard
        key={isOpen ? 'open' : 'closed'}
        steps={steps}
        activeIndex={activeIndex}
        onIndexChange={setActiveIndex}
        onFinish={handleSubmit(onSubmit)}
        formatProgress={(current, total, label) =>
          tCommon('stepProgress', { current, total, label })
        }
      >
        <WizardProgress ariaLabel={tProducts('create.title')} segmented />

        <WizardStep id="basics" valid={nameValid}>
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
        </WizardStep>

        <WizardStep id="pricing">
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
            id="status"
            label={tProducts('create.labels.status')}
            value={status}
            onValueChange={(value) =>
              setValue('status', value, { shouldDirty: true })
            }
            disabled={isSubmitting}
            options={statusOptions}
          />
        </WizardStep>

        <WizardStep id="review">
          <div className="border-border rounded-lg border p-3">
            {values.imageUrl.trim() ? (
              <Row align="center" justify="between" className="py-1">
                <Text variant="muted" className="shrink-0">
                  {tProducts('edit.labels.image')}
                </Text>
                <Image
                  src={values.imageUrl.trim()}
                  alt=""
                  className="border-border size-12 shrink-0 rounded-md border object-cover"
                />
              </Row>
            ) : null}
            <ReviewRow
              label={tProducts('edit.labels.name')}
              value={values.name.trim()}
            />
            <ReviewRow
              label={tProducts('edit.labels.description')}
              value={values.description.trim()}
            />
            <ReviewRow
              label={tProducts('edit.labels.price')}
              value={
                values.price
                  ? `${values.price} ${values.currency}`.trim()
                  : undefined
              }
            />
            <ReviewRow
              label={tProducts('edit.labels.stock')}
              value={values.stock}
            />
            <ReviewRow
              label={tProducts('edit.labels.category')}
              value={values.category.trim()}
            />
            <ReviewRow
              label={tProducts('create.labels.status')}
              value={statusLabel}
            />
          </div>
        </WizardStep>

        <WizardFooter
          backLabel={tCommon('actions.back')}
          nextLabel={tCommon('actions.next')}
          finishLabel={tCommon('actions.create')}
        />
      </Wizard>
    </Dialog>
  );
}
