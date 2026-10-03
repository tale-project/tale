import { cn } from '@tale/ui/cn';

import { BLOG_IMAGE_MANIFEST } from '@/app/generated/blog-image-manifest';

export function blogCover(topicId: string | undefined) {
  return BLOG_IMAGE_MANIFEST.find((image) => image.id === topicId);
}

/** The same optimized, dimensioned image serves index cards and article heroes. */
export function BlogCover({
  topicId,
  alt,
  priority = false,
  className,
}: {
  topicId?: string;
  alt: string;
  priority?: boolean;
  className?: string;
}) {
  const image = blogCover(topicId);
  if (!image) return null;
  const sizes = priority
    ? '(min-width: 1360px) 1264px, (min-width: 768px) calc(100vw - 96px), calc(100vw - 40px)'
    : '(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw';
  const sourceSet = (variants: Record<number, string>) =>
    Object.entries(variants)
      .map(([width, src]) => `${src} ${width}w`)
      .join(', ');
  return (
    <picture>
      <source
        type="image/avif"
        srcSet={sourceSet(image.variants.avif)}
        sizes={sizes}
      />
      <img
        src={image.variants.webp[1200]}
        srcSet={sourceSet(image.variants.webp)}
        sizes={sizes}
        width={image.width}
        height={image.height}
        alt={alt}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
        className={cn(
          'bg-surface-site-inset block aspect-video w-full rounded-xl object-cover',
          className,
        )}
      />
    </picture>
  );
}
