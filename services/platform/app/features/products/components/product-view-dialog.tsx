'use client';

import { Badge } from '@tale/ui/badge';
import { EntityViewDialog } from '@tale/ui/entity/entity-view-dialog';
import { Row } from '@tale/ui/layout';
import type { StatGridItem } from '@tale/ui/stat-grid';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { type RefObject, useMemo } from 'react';

import { useAbility } from '@/app/hooks/use-ability';
import type { ProductDoc } from '@/app/lib/backend/contract/docs';
import { useT } from '@/lib/i18n/client';
import { formatCurrency } from '@/lib/utils/format/number';

import { ProductEditDialog } from './product-edit-dialog';
import { ProductImage } from './product-image';
import { ProductStatusBadge } from './product-status-badge';

interface ProductViewDialogProps {
  isOpen: boolean;
  onClose: () => void;
  product: ProductDoc;
  /** Stable focus target when the opener (a row menu item) unmounts. */
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

export function ProductViewDialog({
  isOpen,
  onClose,
  product,
  restoreFocusRef,
}: ProductViewDialogProps) {
  const { formatDate, locale } = useFormatDate();
  const { t: tCommon } = useT('common');
  const { t: tProducts } = useT('products');
  const ability = useAbility();
  const canWrite = ability.can('write', 'knowledgeWrite');
  const sourceUrl =
    typeof product.metadata?.url === 'string' ? product.metadata.url : null;

  const facts = useMemo<StatGridItem[]>(
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
      ...(product.description
        ? [
            {
              label: tProducts('view.labels.fullDescription'),
              value: (
                <Text className="leading-relaxed whitespace-pre-wrap">
                  {product.description}
                </Text>
              ),
              colSpan: 2 as const,
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
      ...(product.tags && product.tags.length > 0
        ? [
            {
              label: tProducts('view.labels.tags'),
              value: (
                <Row gap={2} wrap>
                  {product.tags.map((tag, index) => (
                    <Badge key={`${tag}-${index}`} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </Row>
              ),
              colSpan: 2 as const,
            },
          ]
        : []),
      ...(sourceUrl
        ? [
            {
              label: tProducts('view.labels.source'),
              value: (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 underline hover:text-blue-700"
                >
                  {sourceUrl}
                </a>
              ),
              colSpan: 2 as const,
            },
          ]
        : []),
    ],
    [product, sourceUrl, tProducts, tCommon, formatDate, locale],
  );

  return (
    <EntityViewDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={tProducts('view.title')}
      name={product.name}
      badges={
        product.status ? (
          <ProductStatusBadge status={product.status} />
        ) : undefined
      }
      media={
        <ProductImage
          images={product.imageUrl ? [product.imageUrl] : []}
          productName={product.name}
          className={
            product.imageUrl
              ? 'size-16 shrink-0 rounded-lg'
              : 'size-10 shrink-0 rounded-lg'
          }
        />
      }
      edit={
        canWrite
          ? {
              label: tCommon('actions.edit'),
              render: ({ onBack, onDone }) => (
                <ProductEditDialog
                  isOpen
                  onClose={onBack}
                  onSaved={onDone}
                  restoreFocusRef={restoreFocusRef}
                  product={product}
                />
              ),
            }
          : undefined
      }
      identifier={{
        label: tProducts('view.labels.productId'),
        value: product._id,
      }}
      facts={facts}
      restoreFocusRef={restoreFocusRef}
    />
  );
}
