'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { CopyableField } from '@tale/ui/copyable-field';
import { ViewDialog } from '@tale/ui/dialog/view-dialog';
import { Field } from '@tale/ui/field';
import { IconButton } from '@tale/ui/icon-button';
import { HStack, Stack } from '@tale/ui/layout';
import { Separator } from '@tale/ui/separator';
import { type StatGridItem, StatGrid } from '@tale/ui/stat-grid';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { Pencil } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { formatCurrency } from '@/lib/utils/format/number';

import {
  ProductEditFields,
  PRODUCT_EDIT_FORM_ID,
  useProductEditForm,
} from './product-edit-form';
import { ProductImage } from './product-image';
import { ProductStatusBadge } from './product-status-badge';

interface ViewProductDialogProps {
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
    tags?: string[];
    status?: string;
    lastUpdated?: number;
    metadata?: Record<string, unknown>;
  };
}

/**
 * Product card (row click). The product name is the view title so the type
 * label is not restated; status is a badge on the title row, not a field
 * in the body. Edit morphs in place on `size="default"` — title becomes
 * "Edit product", the badge and pencil hide, Cancel/Save take the footer.
 * Identity chrome (name + Active) does not follow into the form; the form
 * is a form. Row-action Edit still opens the standalone overlay.
 */
export function ProductViewDialog({
  isOpen,
  onClose,
  product,
}: ViewProductDialogProps) {
  const { formatDate, locale } = useFormatDate();
  const { t: tCommon } = useT('common');
  const { t: tProducts } = useT('products');
  const ability = useAbility();
  const canEdit = ability.can('write', 'knowledgeWrite');
  const [isEditing, setIsEditing] = useState(false);
  const {
    register,
    errors,
    isPending,
    seed,
    setValue,
    watch,
    statusOptions,
    submit,
  } = useProductEditForm(product, () => setIsEditing(false));

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        seed();
        setIsEditing(false);
        onClose();
      }
    },
    [onClose, seed],
  );

  const startEdit = useCallback(() => {
    seed();
    setIsEditing(true);
  }, [seed]);

  const cancelEdit = useCallback(() => {
    seed();
    setIsEditing(false);
  }, [seed]);

  const hasImage = Boolean(product.imageUrl);
  const description = product.description?.trim() ?? '';
  const sourceUrl =
    typeof product.metadata?.url === 'string'
      ? product.metadata.url
      : undefined;

  const statItems = useMemo<StatGridItem[]>(
    () => [
      ...(product.price !== undefined
        ? [
            {
              label: tProducts('view.labels.price'),
              value: (
                <Text>
                  {formatCurrency(
                    product.price,
                    product.currency || 'USD',
                    locale,
                  )}
                </Text>
              ),
            },
          ]
        : []),
      ...(product.stock !== undefined
        ? [
            {
              label: tProducts('view.labels.stock'),
              value: (
                <Text
                  className={
                    product.stock === 0 ? 'font-medium text-red-600' : undefined
                  }
                >
                  {tCommon('units.stock', { count: product.stock })}
                </Text>
              ),
            },
          ]
        : []),
      ...(product.category
        ? [
            {
              label: tProducts('view.labels.category'),
              value: <Text>{product.category}</Text>,
            },
          ]
        : []),
      ...(product.lastUpdated !== undefined
        ? [
            {
              label: tProducts('view.labels.lastUpdated'),
              colSpan: 2 as const,
              value: (
                <Text className="whitespace-nowrap">
                  {formatDate(new Date(product.lastUpdated), 'long')}
                </Text>
              ),
            },
          ]
        : []),
    ],
    [product, tProducts, tCommon, formatDate, locale],
  );

  const hasIntro = hasImage || description.length > 0;
  const headerActions =
    product.status || canEdit ? (
      <>
        {product.status ? <ProductStatusBadge status={product.status} /> : null}
        {canEdit && !isEditing ? (
          <IconButton
            icon={Pencil}
            size="sm"
            aria-label={tCommon('actions.edit')}
            onClick={startEdit}
          />
        ) : null}
      </>
    ) : undefined;

  return (
    <ViewDialog
      open={isOpen}
      onOpenChange={handleOpenChange}
      title={isEditing ? tProducts('edit.title') : product.name}
      size="default"
      headerActions={isEditing ? undefined : headerActions}
      customFooter={
        isEditing ? (
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={cancelEdit}
              disabled={isPending}
            >
              {tCommon('actions.cancel')}
            </Button>
            <Button
              type="submit"
              form={PRODUCT_EDIT_FORM_ID}
              disabled={isPending}
              isLoading={isPending}
            >
              {tCommon('actions.save')}
            </Button>
          </>
        ) : undefined
      }
    >
      {isEditing ? (
        <form
          id={PRODUCT_EDIT_FORM_ID}
          onSubmit={submit}
          className="space-y-4"
          noValidate
        >
          <ProductEditFields
            register={register}
            errors={errors}
            isPending={isPending}
            setValue={setValue}
            watch={watch}
            statusOptions={statusOptions}
            autoFocus
          />
        </form>
      ) : (
        <Stack gap={4}>
          {hasIntro && (
            <HStack gap={4} className="items-start">
              {hasImage && product.imageUrl && (
                <ProductImage
                  images={[product.imageUrl]}
                  productName={product.name}
                  className="size-20 shrink-0 rounded-lg"
                />
              )}
              {description.length > 0 && (
                <Text className="min-w-0 flex-1 leading-relaxed">
                  {description}
                </Text>
              )}
            </HStack>
          )}

          {hasIntro && statItems.length > 0 && <Separator />}

          {statItems.length > 0 && <StatGrid items={statItems} />}

          {product.tags && product.tags.length > 0 && (
            <Field label={tProducts('view.labels.tags')}>
              <HStack gap={2} className="flex-wrap">
                {product.tags.map((tag, index) => (
                  <Badge key={`${tag}-${index}`} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </HStack>
            </Field>
          )}

          {sourceUrl && (
            <Field label={tProducts('view.labels.source')}>
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary text-sm break-all underline-offset-2 hover:underline"
              >
                {sourceUrl}
              </a>
            </Field>
          )}

          <CopyableField
            label={tProducts('view.labels.productId')}
            value={product._id}
          />
        </Stack>
      )}
    </ViewDialog>
  );
}
