'use client';

import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Field } from '@/app/components/ui/forms/field';
import { Stack, HStack, Grid } from '@/app/components/ui/layout/layout';
import { Separator } from '@/app/components/ui/layout/separator';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';
import { formatCurrency } from '@/lib/utils/format/number';

import { ProductImage } from './product-image';

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

  return (
    <ViewDialog
      open={isOpen}
      onOpenChange={onClose}
      title={tProducts('view.title')}
      description={tProducts('view.description')}
      className="sm:max-w-[600px]"
    >
      <Stack gap={4}>
        {/* Product Image and Basic Info */}
        <HStack gap={4} className="items-start">
          <ProductImage
            images={product.imageUrl ? [product.imageUrl] : []}
            productName={product.name}
            className="size-20 flex-shrink-0 rounded-lg"
          />
          <div className="min-w-0 flex-1">
            <h3 className="text-foreground truncate font-semibold">
              {product.name}
            </h3>
            {product.description && (
              <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
                {product.description}
              </p>
            )}
            {product.status && (
              <Badge
                variant={product.status === 'active' ? 'blue' : 'outline'}
                className="mt-2 capitalize"
              >
                {product.status}
              </Badge>
            )}
          </div>
        </HStack>

        <Separator />

        {/* Product Details Grid */}
        <Grid cols={2} gap={4}>
          {product.price !== undefined && (
            <Field label={tProducts('view.labels.price')}>
              {formatCurrency(product.price, product.currency || 'USD', locale)}
            </Field>
          )}

          {product.stock !== undefined && (
            <Field label={tProducts('view.labels.stock')}>
              <span
                className={
                  product.stock === 0 ? 'font-medium text-red-600' : undefined
                }
              >
                {tCommon('units.stock', { count: product.stock })}
              </span>
            </Field>
          )}

          {product.category && (
            <Field label={tProducts('view.labels.category')}>
              {product.category}
            </Field>
          )}

          {product.lastUpdated !== undefined && (
            <Field label={tProducts('view.labels.lastUpdated')}>
              {formatDate(new Date(product.lastUpdated), 'long')}
            </Field>
          )}
        </Grid>

        {/* Tags */}
        {product.tags && product.tags.length > 0 && (
          <Field label={tProducts('view.labels.tags')}>
            <HStack gap={2} className="flex-wrap">
              {product.tags.map((tag, index) => (
                <Badge key={index} variant="outline">
                  {tag}
                </Badge>
              ))}
            </HStack>
          </Field>
        )}

        {/* Full Description */}
        {product.description && (
          <Field label={tProducts('view.labels.fullDescription')}>
            <p className="leading-relaxed">{product.description}</p>
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
      </Stack>
    </ViewDialog>
  );
}
