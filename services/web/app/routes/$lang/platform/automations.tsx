import { createFileRoute } from '@tanstack/react-router';

import { AutomationsPage } from '@/app/pages/platform/automations-page';

export const Route = createFileRoute('/$lang/platform/automations')({
  component: AutomationsPage,
});
