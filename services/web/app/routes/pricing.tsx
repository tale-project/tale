import { createFileRoute } from '@tanstack/react-router';

import { PricingCompare } from '@/app/components/blocks/pricing-compare';
import { PricingTiers } from '@/app/components/blocks/pricing-tiers';
import { useT } from '@/lib/i18n/client';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

export const Route = createFileRoute('/pricing')({
  component: PricingPage,
});

function PricingPage() {
  const { t: tSeo } = useT('seo');

  useDocumentMeta({
    title: tSeo('pricing.title'),
    description: tSeo('pricing.description'),
    canonicalPath: '/pricing',
  });

  return (
    <>
      <PricingTiers />
      <PricingCompare />
    </>
  );
}
