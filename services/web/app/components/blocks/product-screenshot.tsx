import { Card } from '@tale/ui/card';
import { Expand } from 'lucide-react';

import {
  PRODUCT_SCREENSHOTS,
  type ProductScreenshotPage,
  productScreenshotId,
} from '@/app/content/product-screenshots';
import {
  IMAGE_MANIFEST,
  type ImageManifestEntry,
} from '@/app/generated/image-manifest';
import { useT } from '@/lib/i18n/client';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';

function sourceSet(variants: ImageManifestEntry['variants']['webp']): string {
  return Object.entries(variants)
    .map(([width, path]) => `${path} ${width}w`)
    .join(', ');
}

/** Responsive, unretouched product captures; phones receive an intentional detail crop. */
export function ProductScreenshot({ page }: { page: ProductScreenshotPage }) {
  const { t } = useT('demo');
  const locale = useCurrentLocale();
  const { source } = PRODUCT_SCREENSHOTS[page];
  const id = productScreenshotId(source, locale);
  const original = IMAGE_MANIFEST.find((entry) => entry.id === id);
  const desktop =
    IMAGE_MANIFEST.find((entry) => entry.id === `${id}-desktop`) ?? original;
  const mobile = IMAGE_MANIFEST.find((entry) => entry.id === `${id}-mobile`);
  if (!original || !desktop || !mobile)
    throw new Error(`Missing optimized product capture: ${id}`);
  const full = Object.values(original.variants.webp).at(-1);
  const display = Object.values(desktop.variants.webp).at(-1);
  const sizes =
    page === 'home'
      ? '(min-width: 1360px) 700px, (min-width: 1024px) calc(58.33vw - 84px), (min-width: 640px) calc(100vw - 64px), calc(100vw - 40px)'
      : '(min-width: 1360px) 1264px, (min-width: 1024px) calc(100vw - 96px), (min-width: 640px) calc(100vw - 64px), calc(100vw - 40px)';

  return (
    <figure
      data-product-screenshot={page}
      data-demo-domain={page === 'home' || page === 'hub' ? 'projects' : page}
      className="w-full min-w-0"
    >
      <Card
        asChild
        padding="none"
        radius="xl"
        interactive
        className="shadow-demo bg-surface-site-raised group block overflow-hidden"
      >
        <a
          href={full}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('pages.viewFull', { page: t(`pages.${page}.caption`) })}
        >
          <picture>
            <source
              media="(max-width: 639px)"
              type="image/avif"
              srcSet={sourceSet(mobile.variants.avif)}
              sizes={sizes}
              width={mobile.width}
              height={mobile.height}
            />
            <source
              media="(max-width: 639px)"
              type="image/webp"
              srcSet={sourceSet(mobile.variants.webp)}
              sizes={sizes}
              width={mobile.width}
              height={mobile.height}
            />
            <source
              type="image/avif"
              srcSet={sourceSet(desktop.variants.avif)}
              sizes={sizes}
            />
            <img
              src={display}
              srcSet={sourceSet(desktop.variants.webp)}
              sizes={sizes}
              width={desktop.width}
              height={desktop.height}
              alt={t(`pages.${page}.label`)}
              loading="eager"
              fetchPriority="high"
              decoding="async"
              className="block h-auto w-full"
            />
          </picture>
        </a>
      </Card>
      <figcaption className="text-fg-muted mt-4 flex flex-wrap items-start justify-between gap-3 text-xs leading-relaxed">
        <span className="max-w-2xl">
          {t(`pages.${page}.caption`)}
          <span className="text-fg-subtle mt-1 block">
            {t('pages.interfaceLanguage')}
          </span>
        </span>
        <a
          href={full}
          target="_blank"
          rel="noopener noreferrer"
          className="text-fg-base focus-visible:outline-fg-base inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md px-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <Expand aria-hidden className="size-3.5" />
          {t('pages.viewLabel')}
        </a>
      </figcaption>
    </figure>
  );
}
