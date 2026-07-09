import { createFileRoute } from '@tanstack/react-router';

import { AgentsPage } from '@/app/pages/platform/agents-page';

export const Route = createFileRoute('/$lang/platform/agents')({
  component: AgentsPage,
});
