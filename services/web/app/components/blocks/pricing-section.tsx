import { useState } from 'react';

import { PricingCompare } from '@/app/components/blocks/pricing-compare';
import { PricingTiers } from '@/app/components/blocks/pricing-tiers';
import { detectDefaultRegion, type Region } from '@/lib/pricing/region';

export type Billing = 'monthly' | 'yearly';

export function PricingSection() {
  const [billing, setBilling] = useState<Billing>('yearly');
  const [region, setRegion] = useState<Region>(() => detectDefaultRegion());

  return (
    <>
      <PricingTiers
        billing={billing}
        region={region}
        onBillingChange={setBilling}
        onRegionChange={setRegion}
      />
      <PricingCompare region={region} />
    </>
  );
}
