'use client';

import { Badge } from '@tale/ui/badge';
import { Heading } from '@tale/ui/heading';
import { HStack } from '@tale/ui/layout';
import { Separator } from '@tale/ui/separator';
import { type StatGridItem, StatGrid } from '@tale/ui/stat-grid';
import { Text } from '@tale/ui/text';
import { useMemo } from 'react';

import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { Field, FieldGroup } from '@/app/components/ui/forms/field';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';
import { formatCurrency } from '@/lib/utils/format/number';

import { ProductImage } from './product-image';
import { ProductStatusBadge } from './product-status-badge';

interface ViewProductDialogProps {
  isOpen: boolean;
  onClose: () => void;
  product: {
    _id: string;
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

export function ProductViewDialog({
  isOpen,
  onClose,
  product,
}: ViewProductDialogProps) {
  const { formatDate, locale } = useFormatDate();
  const { t: tCommon } = useT('common');
  const { t: tProducts } = useT('products');

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
              value: (
                <Text>{formatDate(new Date(product.lastUpdated), 'long')}</Text>
              ),
            },
          ]
        : []),
    ],
    [product, tProducts, tCommon, formatDate, locale],
  );

  return (
    <ViewDialog
      open={isOpen}
      onOpenChange={onClose}
      title={tProducts('view.title')}
      description={tProducts('view.description')}
      className="sm:max-w-[600px]"
    >
      <FieldGroup gap={4}>
        <HStack gap={4} className="items-start">
          <ProductImage
            images={product.imageUrl ? [product.imageUrl] : []}
            productName={product.name}
            className="size-20 shrink-0 rounded-lg"
          />
          <div className="min-w-0 flex-1">
            <Heading level={3} className="break-words">
              {product.name}
            </Heading>
            {product.description && (
              <Text variant="muted" className="mt-1 line-clamp-2">
                {product.description}
              </Text>
            )}
            {product.status && (
              <ProductStatusBadge status={product.status} className="mt-2" />
            )}
          </div>
        </HStack>

        <Separator />

        {statItems.length > 0 && <StatGrid items={statItems} />}

        {/* Tags */}
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

        {/* Full Description */}
        {product.description && (
          <Field label={tProducts('view.labels.fullDescription')}>
            <Text className="leading-relaxed">{product.description}</Text>
          </Field>
        )}

        {/* Product Source URL */}
        {typeof product.metadata?.url === 'string' && (
          <Field label={tProducts('view.labels.source')}>
            <a
              href={product.metadata.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm break-all text-blue-600 underline hover:text-blue-700"
            >
              {product.metadata.url}
            </a>
          </Field>
        )}

        {/* Product ID */}
        <Field label={tProducts('view.labels.productId')}>
          <code className="bg-muted rounded px-2 py-1 text-xs">
            {product._id}
          </code>
        </Field>
      </FieldGroup>
    </ViewDialog>
  );
}
