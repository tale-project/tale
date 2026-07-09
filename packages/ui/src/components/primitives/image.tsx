import {
  type ComponentPropsWithoutRef,
  forwardRef,
  useEffect,
  useState,
} from 'react';

import { cn } from '../../lib/cn';

const DEFAULT_PLACEHOLDER = '/assets/placeholder-image.png';

interface ImageProps extends Omit<ComponentPropsWithoutRef<'img'>, 'onError'> {
  /**
   * Fallback image URL used when the primary image fails to load.
   * Defaults to `/assets/placeholder-image.png`.
   */
  fallbackSrc?: string;
  /**
   * When true, disables lazy loading (uses `loading="eager"`).
   * Use for above-the-fold images.
   */
  priority?: boolean;
  /**
   * Responsive `srcset` string. Passed through to the underlying `<img>`.
   */
  srcSet?: string;
  /**
   * Sizes hint paired with `srcSet`.
   */
  sizes?: string;
  /**
   * Intrinsic width — reserves layout space (CLS 0) when height is also set.
   */
  width?: number;
  /**
   * Intrinsic height — reserves layout space (CLS 0) when width is also set.
   */
  height?: number;
  /**
   * Tiny base64 (or data-URL) blur preview shown as a CSS background until
   * the full image loads. Additive — existing callers are unchanged.
   */
  blurDataURL?: string;
}

/**
 * Custom Image component built on the native `<img>` element.
 *
 * Features:
 * - Automatic fallback on error
 * - Lazy loading by default (disable with `priority`)
 * - Optional srcset / sizes / dimensions / blur placeholder
 */
export const Image = forwardRef<HTMLImageElement, ImageProps>(function Image(
  {
    src,
    alt,
    className,
    fallbackSrc = DEFAULT_PLACEHOLDER,
    priority = false,
    loading,
    srcSet,
    sizes,
    width,
    height,
    blurDataURL,
    style,
    ...props
  },
  ref,
) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const currentSrc = failedSrc === src ? fallbackSrc : src || fallbackSrc;

  useEffect(() => {
    setFailedSrc(null);
    setLoaded(false);
  }, [src]);

  const handleError = () => {
    setFailedSrc(src ?? null);
  };

  const blurStyle =
    blurDataURL && !loaded
      ? {
          ...style,
          backgroundImage: `url(${blurDataURL})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }
      : style;

  return (
    <img
      key={src}
      ref={ref}
      src={currentSrc}
      srcSet={srcSet}
      sizes={sizes}
      width={width}
      height={height}
      alt={alt}
      className={cn(className)}
      style={blurStyle}
      loading={loading ?? (priority ? 'eager' : 'lazy')}
      onError={handleError}
      onLoad={() => setLoaded(true)}
      {...props}
    />
  );
});
