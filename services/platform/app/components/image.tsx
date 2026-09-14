'use client';

import { Image as BaseImage } from '@tale/ui/image';
import { type ComponentPropsWithoutRef, forwardRef } from 'react';

import { getEnv } from '@/lib/env';

type BaseImageProps = ComponentPropsWithoutRef<typeof BaseImage>;

/**
 * Platform-flavored Image component.
 *
 * Wraps the shared `@tale/ui/image` primitive and prefixes the default
 * placeholder fallback with `BASE_PATH` so subpath deployments resolve the
 * placeholder asset correctly.
 */
export const Image = forwardRef<HTMLImageElement, BaseImageProps>(
  function Image({ fallbackSrc, ...props }, ref) {
    const resolvedFallback =
      fallbackSrc ?? `${getEnv('BASE_PATH')}/assets/placeholder-image.png`;
    return <BaseImage ref={ref} fallbackSrc={resolvedFallback} {...props} />;
  },
);
