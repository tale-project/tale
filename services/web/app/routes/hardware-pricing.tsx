import { createFileRoute } from '@tanstack/react-router';

import { HardwareCompare } from '@/app/components/blocks/hardware-compare';
import { HardwareTiers } from '@/app/components/blocks/hardware-tiers';
import { useT } from '@/lib/i18n/client';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

export const Route = createFileRoute('/hardware-pricing')({
  component: HardwarePricingPage,
});

function HardwarePricingPage() {
  const { t: tSeo } = useT('seo');

  useDocumentMeta({
    title: tSeo('hardwarePricing.title'),
    description: tSeo('hardwarePricing.description'),
    canonicalPath: '/hardware-pricing',
  });

  return (
    <>
      <HardwareTiers />
      <HardwareCompare />
    </>
  );
}
