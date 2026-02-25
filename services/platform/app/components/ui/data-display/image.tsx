'use client';

import { ComponentPropsWithoutRef, forwardRef, useState } from 'react';

import { cn } from '@/lib/utils/cn';

const PLACEHOLDER_IMAGE = '/assets/placeholder-image.png';

interface ImageProps extends Omit<ComponentPropsWithoutRef<'img'>, 'onError'> {
  /**
   * Fallback image URL to use when the primary image fails to load.
   * Defaults to '/assets/placeholder-image.png'.
   */
  fallbackSrc?: string;
  /**
   * When true, disables lazy loading (uses loading="eager").
   * Use for above-the-fold images.
   */
  priority?: boolean;
}

/**
 * Custom Image component that uses native img element.
 *
 * Features:
 * - Automatic fallback on error
 * - Lazy loading by default (disable with priority prop)
 * - Full control over styling
 */
export const Image = forwardRef<HTMLImageElement, ImageProps>(function Image(
  {
    src,
    alt,
    className,
    fallbackSrc = PLACEHOLDER_IMAGE,
    priority = false,
    ...props
  },
  ref,
) {
  const [hasError, setHasError] = useState(false);
  const currentSrc = hasError ? fallbackSrc : src || fallbackSrc;

  const handleError = () => {
    if (!hasError) {
      setHasError(true);
    }
  };

  return (
    <img
      key={src}
      ref={ref}
      src={currentSrc}
      alt={alt}
      className={cn(className)}
      loading={priority ? 'eager' : 'lazy'}
      onError={handleError}
      {...props}
    />
  );
});
