'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useState } from 'react';

import { PagePointerPin } from '../../components/overlays/page-pointer-pin';
import { Picture } from '../../components/primitives/picture';
import { useT } from '../../i18n/client';
import { type ResponsiveImage, widestVariant } from '../../images/responsive';
import { cn } from '../../lib/cn';

interface ImageZoomProps {
  /** The full-size file: the lightbox always opens it. */
  src?: string;
  alt?: string;
  className?: string;
  /** Variants along the shared ladder (`@tale/ui/images/responsive`). With
   * them the trigger renders a `<Picture>`, so the browser fetches the
   * variant its slot needs and reserves the box from the intrinsic size. */
  image?: ResponsiveImage;
  /** The trigger's slot width for `image`, as in `<img sizes>`; defaults to
   * `100vw`, the browser's own default. */
  sizes?: string;
}

/**
 * Click-to-zoom lightbox for markdown content images. The collapsed state
 * renders the regular lazy `<img>` (or, given `image`, a responsive
 * `<Picture>`) inside a button trigger; activating it opens a modal showing
 * the full-size image near full-viewport over a dimmed overlay.
 * Radix supplies the focus trap, ESC close, and focus restore; the portal
 * content only mounts on interaction, so the component is safe to render
 * during SSG/SSR prerender.
 *
 * Translatable labels live under the `markdownImage` namespace:
 *   { zoom, close }.
 */
export function ImageZoom({
  src,
  alt,
  className,
  image,
  sizes = '100vw',
}: ImageZoomProps) {
  const { t } = useT('markdownImage');
  const [open, setOpen] = useState(false);
  const trimmedAlt = alt?.trim() ?? '';
  const fullSize = src ?? (image && widestVariant(image.variants.webp));
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        // The image's own alt names the trigger; only fall back to the
        // generic zoom label when the image ships no alt text.
        aria-label={trimmedAlt === '' ? t('zoom') : undefined}
        className={cn(
          'focus-visible:ring-fg-base/60 focus-visible:ring-offset-bg-base my-6 block max-w-full cursor-zoom-in rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
          className,
        )}
      >
        {image ? (
          <Picture
            image={image}
            sizes={sizes}
            src={src}
            alt={trimmedAlt}
            loading="lazy"
            decoding="async"
            className="border-border-base h-auto max-w-full rounded-lg border"
          />
        ) : (
          <img
            src={src}
            alt={trimmedAlt}
            loading="lazy"
            decoding="async"
            className="border-border-base h-auto max-w-full rounded-lg border"
          />
        )}
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center p-4 focus:outline-none"
          onClick={(event) => {
            // Radix only auto-closes on pointer-down *outside* the content,
            // and this content stretches over the whole viewport — close when
            // the backdrop area itself (not the image or the close button)
            // is clicked.
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <PagePointerPin />
          <DialogPrimitive.Title className="sr-only">
            {trimmedAlt === '' ? t('zoom') : trimmedAlt}
          </DialogPrimitive.Title>
          <img
            src={fullSize}
            alt={trimmedAlt}
            className="max-h-[90vh] max-w-[95vw] cursor-default rounded-lg object-contain"
          />
          <DialogPrimitive.Close
            aria-label={t('close')}
            className="absolute top-4 right-4 rounded-md bg-white/10 p-2 text-white transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <X aria-hidden className="size-5" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
