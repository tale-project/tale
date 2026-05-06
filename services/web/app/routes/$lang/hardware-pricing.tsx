import { createFileRoute } from '@tanstack/react-router';

import { HardwarePricingPage } from '@/app/pages/hardware-pricing-page';

export const Route = createFileRoute('/$lang/hardware-pricing')({
  component: HardwarePricingPage,
});
