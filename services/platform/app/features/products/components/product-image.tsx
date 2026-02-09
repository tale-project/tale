'use client';

import { ComponentPropsWithoutRef } from 'react';

import { Image } from '@/app/components/ui/data-display/image';
import { cn } from '@/lib/utils/cn';

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
        className="h-full w-full object-cover"
      />
      {hasImages && images.length > 1 && (
        <>
          <div className="bg-background text-muted-foreground absolute -top-4 -right-4 hidden size-6 items-center justify-center rounded-full border text-xs group-hover:flex">
            +{images.length - 1}
          </div>
          <div className="bg-background absolute top-0 left-full z-50 ml-2 hidden min-w-[280px] rounded-md border p-4 shadow-lg group-hover:block">
            <div className="grid grid-cols-2 gap-4">
              {images.map((image, imgIndex) => (
                <div
                  key={imgIndex}
                  className="bg-muted relative h-32 w-32 overflow-hidden rounded-md"
                >
                  <Image
                    src={image}
                    alt={`${productName} - ${imgIndex + 1}`}
                    width={128}
                    height={128}
                    className="h-full w-full object-cover"
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
