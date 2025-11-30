'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { RecommendedProduct, PreviousPurchase } from '../types/approval-detail';
import { formatDate } from '@/lib/utils/date/format';

interface ProductCardProps {
  product?: RecommendedProduct;
  purchase?: PreviousPurchase;
  type: 'recommended' | 'purchase';
  onRemove?: (productId: string) => void;
  isRemoving?: boolean;
  canRemove?: boolean;
}

interface ImageWithFallbackProps {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
}

function ImageWithFallback({
  src,
  alt,
  width,
  height,
  className,
}: ImageWithFallbackProps) {
  const [currentSrc, setCurrentSrc] = useState<string>(
    src || '/assets/placeholder-image.png',
  );

  useEffect(() => {
    setCurrentSrc(src || '/assets/placeholder-image.png');
  }, [src]);

  return (
    <Image
      src={currentSrc}
      alt={alt}
      width={width}
      height={height}
      className={className}
      unoptimized
      onError={() => setCurrentSrc('/assets/placeholder-image.png')}
    />
  );
}

export default function ProductCard({
  product,
  purchase,
  type,
  onRemove,
  isRemoving,
  canRemove,
}: ProductCardProps) {
  if (type === 'recommended' && product) {
    return (
      <div className="flex items-start gap-3 p-3 border-b border-border last:border-b-0">
        <div className="w-[72px] h-[72px] bg-muted rounded-lg overflow-hidden flex-shrink-0">
          <ImageWithFallback
            src={product.image}
            alt={product.name}
            width={72}
            height={72}
            className="w-full h-full object-cover"
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="space-y-3">
            <div className="space-y-1">
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
            </div>
            <div className="flex items-center gap-2">
              {product.relationshipType && (
                <Badge variant="outline">{product.relationshipType}</Badge>
              )}
              {product.confidence !== undefined && (
                <Badge variant="outline">
                  {Math.round(product.confidence * 100)}% confidence
                </Badge>
              )}
            </div>
          </div>
        </div>
        {canRemove && onRemove && (
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onRemove(product.id)}
            disabled={isRemoving}
            className="size-8 flex-shrink-0"
          >
            {isRemoving ? (
              <div className="animate-spin rounded-full size-4 border-b border-foreground" />
            ) : (
              <X className="size-4 text-muted-foreground hover:text-foreground" />
            )}
          </Button>
        )}
      </div>
    );
  }

  if (type === 'purchase' && purchase) {
    return (
      <div className="flex items-center gap-3 p-3 border-b border-border last:border-b-0">
        <div className="flex-1 flex items-center gap-2">
          <div className="size-10 bg-muted rounded-md overflow-hidden flex-shrink-0">
            <ImageWithFallback
              src={purchase.image}
              alt={purchase.productName}
              width={40}
              height={40}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="space-y-1">
            <h4 className="text-sm font-medium text-foreground">
              {purchase.productName}
            </h4>
            {purchase.purchaseDate && (
              <p className="text-xs text-muted-foreground">
                {formatDate(purchase.purchaseDate)}
              </p>
            )}
          </div>
        </div>
        {purchase.status && (
          <Badge
            variant={purchase.status === 'active' ? 'green' : 'destructive'}
          >
            {purchase.status === 'active' ? 'Active' : 'Cancelled'}
          </Badge>
        )}
      </div>
    );
  }

  return null;
}
