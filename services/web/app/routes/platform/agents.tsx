import { createFileRoute } from '@tanstack/react-router';

import { AgentsPage } from '@/app/pages/platform/agents-page';

export const Route = createFileRoute('/platform/agents')({
  component: AgentsPage,
});
