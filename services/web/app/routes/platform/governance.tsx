import { createFileRoute } from '@tanstack/react-router';

import { GovernancePage } from '@/app/pages/platform/governance-page';

export const Route = createFileRoute('/platform/governance')({
  component: GovernancePage,
});
