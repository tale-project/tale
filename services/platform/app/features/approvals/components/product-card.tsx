'use client';

import { X } from 'lucide-react';

import { Image } from '@/app/components/ui/data-display/image';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';

import { RecommendedProduct, PreviousPurchase } from '../types/approval-detail';

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
  const { formatDate } = useFormatDate();
  const { t } = useT('approvals');

  if (type === 'recommended' && product) {
    return (
      <HStack
        gap={3}
        align="start"
        className="border-border border-b p-3 last:border-b-0"
      >
        <div className="bg-muted h-[72px] w-[72px] shrink-0 overflow-hidden rounded-lg">
          <Image
            src={product.image}
            alt={product.name}
            width={72}
            height={72}
            className="h-full w-full object-cover"
          />
        </div>
        <div className="min-w-0 flex-1">
          <Stack gap={3}>
            <Stack gap={1}>
              <h4 className="text-foreground text-sm leading-normal font-medium">
                {product.name}
              </h4>
              {product.description && (
                <p className="text-muted-foreground line-clamp-2 text-sm leading-5">
                  {product.description}
                </p>
              )}
              {product.reasoning && (
                <p className="text-muted-foreground text-sm leading-5">
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
                  {t('confidenceBadge', {
                    percent: Math.round(product.confidence * 100),
                  })}
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
              <div className="border-foreground size-4 animate-spin rounded-full border-b" />
            ) : (
              <X className="text-muted-foreground hover:text-foreground size-4" />
            )}
          </Button>
        )}
      </HStack>
    );
  }

  if (type === 'purchase' && purchase) {
    return (
      <HStack gap={3} className="border-border border-b p-3 last:border-b-0">
        <HStack gap={2} className="flex-1">
          <div className="bg-muted size-10 shrink-0 overflow-hidden rounded-md">
            <Image
              src={purchase.image}
              alt={purchase.productName}
              width={40}
              height={40}
              className="h-full w-full object-cover"
            />
          </div>
          <Stack gap={1}>
            <h4 className="text-foreground text-sm font-medium">
              {purchase.productName}
            </h4>
            {purchase.purchaseDate && (
              <p className="text-muted-foreground text-xs">
                {formatDate(purchase.purchaseDate)}
              </p>
            )}
          </Stack>
        </HStack>
        {purchase.status && (
          <Badge
            variant={purchase.status === 'active' ? 'green' : 'destructive'}
          >
            {purchase.status === 'active'
              ? t('productStatus.active')
              : t('productStatus.cancelled')}
          </Badge>
        )}
      </HStack>
    );
  }

  return null;
}
