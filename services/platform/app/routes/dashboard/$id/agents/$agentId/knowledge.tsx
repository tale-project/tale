import { createFileRoute } from '@tanstack/react-router';

import { RebuildGate } from '@/app/components/layout/rebuild-gate';

export const Route = createFileRoute(
  '/dashboard/$id/agents/$agentId/knowledge',
)({
  component: () => <RebuildGate feature="Agents" />,
});
