import { createFileRoute } from '@tanstack/react-router';

import { RebuildGate } from '@/app/components/layout/rebuild-gate';

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/agents',
)({
  component: () => <RebuildGate feature="Agents" />,
});
