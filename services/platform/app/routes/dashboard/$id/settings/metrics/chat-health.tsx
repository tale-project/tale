import { createFileRoute } from '@tanstack/react-router';

import { RebuildGate } from '@/app/components/layout/rebuild-gate';

export const Route = createFileRoute(
  '/dashboard/$id/settings/metrics/chat-health',
)({
  component: () => <RebuildGate feature="Chat health metrics" />,
});
