// Do NOT change this, it needs img element for rendering external images.
/* eslint-disable @next/next/no-img-element */
'use client';

import { cn } from '@/lib/utils/cn';
import { ComponentPropsWithoutRef, useState } from 'react';
import { useT } from '@/lib/i18n';

interface ProductImageProps extends ComponentPropsWithoutRef<'div'> {
  images: string[];
  productName: string;
}

export function ProductImage({
  images,
  productName,
  className,
  ...restProps
}: ProductImageProps) {
  const { t } = useT('products');
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  const handleImageError = (imageUrl: string) => {
    setFailedImages((prev) => new Set(prev).add(imageUrl));
  };

  const getImageUrl = (imageUrl: string) => {
    return failedImages.has(imageUrl)
      ? '/assets/placeholder-image.png'
      : imageUrl;
  };

  if (!images || images.length === 0) {
    return (
      <div
        className={cn(
          'w-20 h-20 bg-gray-100 rounded-md flex items-center justify-center text-gray-400 text-xs',
          className,
        )}
      >
        {t('noImage')}
      </div>
    );
  }

  return (
    <div
      className={cn('relative w-20 h-20 group cursor-pointer', className)}
      {...restProps}
    >
      <img
        src={getImageUrl(images[0])}
        alt={productName}
        className="w-full h-full object-cover rounded-md"
        loading="lazy"
        onError={() => handleImageError(images[0])}
      />
      {images.length > 1 && (
        <>
          <div className="hidden group-hover:flex absolute -right-4 -top-4 bg-background rounded-full size-6 items-center justify-center text-xs text-muted-foreground border">
            +{images.length - 1}
          </div>
          <div className="hidden group-hover:block absolute top-0 left-full ml-2 z-50 bg-background p-4 rounded-md shadow-lg border min-w-[280px]">
            <div className="grid grid-cols-2 gap-4">
              {images.map((image, imgIndex) => (
                <div key={imgIndex} className="relative w-32 h-32">
                  <img
                    src={getImageUrl(image)}
                    alt={`${productName} - ${imgIndex + 1}`}
                    className="w-full h-full object-cover rounded-md"
                    loading="lazy"
                    onError={() => handleImageError(image)}
                  />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
