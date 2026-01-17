'use client';

import { Image } from '@/app/components/ui/data-display/image';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Button } from '@/app/components/ui/primitives/button';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { X } from 'lucide-react';
import { RecommendedProduct, PreviousPurchase } from '../types/approval-detail';
import { formatDate } from '@/lib/utils/date/format';
import { useLocale, useT } from '@/lib/i18n/client';

interface ProductCardProps {
  product?: RecommendedProduct;
  purchase?: PreviousPurchase;
  type: 'recommended' | 'purchase';
  onRemove?: (productId: string) => void;
  isRemoving?: boolean;
  canRemove?: boolean;
}

export function ProductCard({
  product,
  purchase,
  type,
  onRemove,
  isRemoving,
  canRemove,
}: ProductCardProps) {
  const locale = useLocale();
  const { t } = useT('approvals');

  if (type === 'recommended' && product) {
    return (
      <HStack gap={3} align="start" className="p-3 border-b border-border last:border-b-0">
        <div className="w-[72px] h-[72px] bg-muted rounded-lg overflow-hidden shrink-0">
          <Image
            src={product.image}
            alt={product.name}
            width={72}
            height={72}
            className="w-full h-full object-cover"
          />
        </div>
        <div className="flex-1 min-w-0">
          <Stack gap={3}>
            <Stack gap={1}>
              <h4 className="text-sm font-medium text-foreground leading-normal">
                {product.name}
              </h4>
              {product.description && (
                <p className="text-sm text-muted-foreground leading-5 line-clamp-2">
                  {product.description}
                </p>
              )}
              {product.reasoning && (
                <p className="text-sm text-muted-foreground leading-5">
                  {product.reasoning}
                </p>
              )}
            </Stack>
            <HStack gap={2}>
              {product.relationshipType && (
                <Badge variant="outline">{product.relationshipType}</Badge>
              )}
              {product.confidence !== undefined && (
                <Badge variant="outline">
                  {t('confidenceBadge', { percent: Math.round(product.confidence * 100) })}
                </Badge>
              )}
            </HStack>
          </Stack>
        </div>
        {canRemove && onRemove && (
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onRemove(product.id)}
            disabled={isRemoving}
            className="size-8 shrink-0"
            aria-label={t('actions.removeProduct', { name: product.name })}
          >
            {isRemoving ? (
              <div className="animate-spin rounded-full size-4 border-b border-foreground" />
            ) : (
              <X className="size-4 text-muted-foreground hover:text-foreground" />
            )}
          </Button>
        )}
      </HStack>
    );
  }

  if (type === 'purchase' && purchase) {
    return (
      <HStack gap={3} className="p-3 border-b border-border last:border-b-0">
        <HStack gap={2} className="flex-1">
          <div className="size-10 bg-muted rounded-md overflow-hidden shrink-0">
            <Image
              src={purchase.image}
              alt={purchase.productName}
              width={40}
              height={40}
              className="w-full h-full object-cover"
            />
          </div>
          <Stack gap={1}>
            <h4 className="text-sm font-medium text-foreground">
              {purchase.productName}
            </h4>
            {purchase.purchaseDate && (
              <p className="text-xs text-muted-foreground">
                {formatDate(purchase.purchaseDate, { locale })}
              </p>
            )}
          </Stack>
        </HStack>
        {purchase.status && (
          <Badge
            variant={purchase.status === 'active' ? 'green' : 'destructive'}
          >
            {purchase.status === 'active' ? t('productStatus.active') : t('productStatus.cancelled')}
          </Badge>
        )}
      </HStack>
    );
  }

  return null;
}
