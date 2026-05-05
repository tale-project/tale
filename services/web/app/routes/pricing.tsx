import { createFileRoute } from '@tanstack/react-router';

import { PricingCompare } from '@/app/components/blocks/pricing-compare';
import { PricingExtras } from '@/app/components/blocks/pricing-extras';
import { PricingTerms } from '@/app/components/blocks/pricing-terms';
import { PricingTiers } from '@/app/components/blocks/pricing-tiers';

export const Route = createFileRoute('/pricing')({
  component: PricingPage,
});

function PricingPage() {
  return (
    <>
      <PricingTiers />
      <PricingCompare />
      <PricingExtras />
      <PricingTerms />
    </>
  );
}
