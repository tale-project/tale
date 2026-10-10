import type { ProductScreenshotPage } from '@/app/content/product-screenshots';

import { ProductScreenshot } from './product-screenshot';

type PageIllustrationKind =
  | 'about'
  | 'contact'
  | 'demo'
  | 'pricing'
  | 'hardware'
  | 'changelog';

/**
 * Public pages use the same responsive product captures as the homepage.
 * Keeping this adapter lets each page retain its semantic slot while the
 * visual stays a real Tale screen with the localized motion treatment.
 */
const PRODUCT_PAGE_BY_KIND: Record<
  PageIllustrationKind,
  ProductScreenshotPage
> = {
  about: 'projects',
  contact: 'chat',
  demo: 'automations',
  pricing: 'governance',
  hardware: 'agents',
  changelog: 'projects',
};

export function PageIllustration({
  kind,
  className,
}: {
  kind: PageIllustrationKind;
  className?: string;
}) {
  return (
    <div className={className} data-page-illustration={kind}>
      <ProductScreenshot page={PRODUCT_PAGE_BY_KIND[kind]} />
    </div>
  );
}
