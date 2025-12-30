'use client';

import { ViewModal } from '@/components/ui/modals';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Stack, HStack, Grid } from '@/components/ui/layout';
import ProductImage from './product-image';
import { formatDate } from '@/lib/utils/date/format';
import { formatCurrency } from '@/lib/utils/format';
import { useLocale, useT } from '@/lib/i18n';

interface ViewProductDialogProps {
  isOpen: boolean;
  onClose: () => void;
  product: {
    id: string;
    name: string;
    description?: string;
    imageUrl?: string;
    stock?: number;
    price?: number;
    currency?: string;
    category?: string;
    tags?: string[];
    status?: string;
    lastUpdated: number;
    metadata?: Record<string, unknown>;
  };
}

export default function ViewProductDialog({
  isOpen,
  onClose,
  product,
}: ViewProductDialogProps) {
  const locale = useLocale();
  const { t: tCommon } = useT('common');
  const { t: tProducts } = useT('products');

  return (
    <ViewModal
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
            className="size-20 rounded-lg flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-foreground truncate">
              {product.name}
            </h3>
            {product.description && (
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
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
          {/* Price */}
          {product.price !== undefined && (
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {tProducts('view.labels.price')}
              </label>
              <p className="text-sm text-foreground mt-1">
                {formatCurrency(product.price, product.currency || 'USD', locale)}
              </p>
            </div>
          )}

          {/* Stock */}
          {product.stock !== undefined && (
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {tProducts('view.labels.stock')}
              </label>
              <p
                className={`text-sm mt-1 ${
                  product.stock === 0
                    ? 'text-red-600 font-medium'
                    : 'text-foreground'
                }`}
              >
                {tCommon('units.stock', { count: product.stock })}
              </p>
            </div>
          )}

          {/* Category */}
          {product.category && (
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {tProducts('view.labels.category')}
              </label>
              <p className="text-sm text-foreground mt-1">
                {product.category}
              </p>
            </div>
          )}

          {/* Last Updated */}
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {tProducts('view.labels.lastUpdated')}
            </label>
            <p className="text-sm text-foreground mt-1">
              {formatDate(new Date(product.lastUpdated), {
                preset: 'long',
              })}
            </p>
          </div>
        </Grid>

        {/* Tags */}
        {product.tags && product.tags.length > 0 && (
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">
              {tProducts('view.labels.tags')}
            </label>
            <HStack gap={2} className="flex-wrap">
              {product.tags.map((tag, index) => (
                <Badge key={index} variant="outline">
                  {tag}
                </Badge>
              ))}
            </HStack>
          </div>
        )}

        {/* Full Description */}
        {product.description && (
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">
              {tProducts('view.labels.fullDescription')}
            </label>
            <p className="text-sm text-foreground leading-relaxed">
              {product.description}
            </p>
          </div>
        )}

        {/* Product Source URL */}
        {typeof product.metadata?.url === 'string' && (
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">
              {tProducts('view.labels.source')}
            </label>
            <a
              href={product.metadata.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:text-blue-700 underline break-all"
            >
              {product.metadata.url}
            </a>
          </div>
        )}

        {/* Product ID */}
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">
            {tProducts('view.labels.productId')}
          </label>
          <code className="text-xs bg-muted px-2 py-1 rounded">
            {product.id}
          </code>
        </div>
      </Stack>
    </ViewModal>
  );
}
