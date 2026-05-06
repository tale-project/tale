import { createFileRoute } from '@tanstack/react-router';

import { PricingPage } from '@/app/pages/pricing-page';

export const Route = createFileRoute('/$lang/pricing')({
  component: PricingPage,
});
