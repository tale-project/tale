import { useMemo } from 'react';

import { PricingSection } from '@/app/components/blocks/pricing-section';
import { useT } from '@/lib/i18n/client';
import { buildTaleSoftwareApplicationJsonLd } from '@/lib/seo/software-application';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

export function PricingPage() {
  const { t: tSeo } = useT('seo');

  // Same SoftwareApplication node (@id) the homepage declares — consistent
  // re-declaration, with offers sourced from the pricing constants the page
  // itself renders.
  const jsonLd = useMemo(
    () => [buildTaleSoftwareApplicationJsonLd(tSeo('pricing.description'))],
    [tSeo],
  );

  useDocumentMeta({
    title: tSeo('pricing.title'),
    description: tSeo('pricing.description'),
    path: '/pricing',
    jsonLd,
  });

  return <PricingSection />;
}
