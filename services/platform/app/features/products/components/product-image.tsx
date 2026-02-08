'use client';

import { cn } from '@/lib/utils/cn';
import { Image } from '@/app/components/ui/data-display/image';
import { ComponentPropsWithoutRef } from 'react';

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
  const hasImages = images && images.length > 0;

  return (
    <div
      className={cn(
        'relative w-20 h-20 bg-muted rounded-md overflow-hidden',
        hasImages && 'group cursor-pointer',
        className,
      )}
      {...restProps}
    >
      <Image
        src={hasImages ? images[0] : undefined}
        alt={productName}
        width={80}
        height={80}
        className="w-full h-full object-cover"
      />
      {hasImages && images.length > 1 && (
        <>
          <div className="hidden group-hover:flex absolute -right-4 -top-4 bg-background rounded-full size-6 items-center justify-center text-xs text-muted-foreground border">
            +{images.length - 1}
          </div>
          <div className="hidden group-hover:block absolute top-0 left-full ml-2 z-50 bg-background p-4 rounded-md shadow-lg border min-w-[280px]">
            <div className="grid grid-cols-2 gap-4">
              {images.map((image, imgIndex) => (
                <div
                  key={imgIndex}
                  className="relative w-32 h-32 bg-muted rounded-md overflow-hidden"
                >
                  <Image
                    src={image}
                    alt={`${productName} - ${imgIndex + 1}`}
                    width={128}
                    height={128}
                    className="w-full h-full object-cover"
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
