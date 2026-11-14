'use client';

import { cn } from '@tale/ui/cn';
import { Grid } from '@tale/ui/layout';
import type { ComponentPropsWithoutRef } from 'react';

import { Image } from '@/app/components/image';
import { productImageVariantUrl } from '@/lib/shared/product-images';

interface ProductImageProps extends ComponentPropsWithoutRef<'div'> {
  images: string[];
  productName: string;
  /**
   * Serve each slot its variant (the list cell and the hover card). `false`
   * serves the original upload, as the product's own view does.
   */
  variants?: boolean;
}

export function ProductImage({
  images,
  productName,
  variants = true,
  className,
  ...restProps
}: ProductImageProps) {
  const hasImages = images && images.length > 0;
  const cellSrc = hasImages
    ? variants
      ? productImageVariantUrl(images[0], 'list')
      : images[0]
    : undefined;
  const cardSrc = (image: string) =>
    variants ? productImageVariantUrl(image, 'card') : image;

  return (
    <div
      className={cn(
        'bg-muted relative h-20 w-20 overflow-hidden rounded-md',
        hasImages && 'group cursor-pointer',
        className,
      )}
      {...restProps}
    >
      <Image
        src={cellSrc}
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
            <Grid cols={2}>
              {images.map((image, imgIndex) => (
                <div
                  key={imgIndex}
                  className="bg-muted relative h-32 w-32 overflow-hidden rounded-md"
                >
                  <Image
                    src={cardSrc(image)}
                    alt={`${productName} - ${imgIndex + 1}`}
                    width={128}
                    height={128}
                    className="h-full w-full object-cover"
                  />
                </div>
              ))}
            </Grid>
          </div>
        </>
      )}
    </div>
  );
}
