import { createFileRoute } from '@tanstack/react-router';

import { RebuildGate } from '@/app/components/layout/rebuild-gate';

export const Route = createFileRoute('/dashboard/$id/settings/api/runtimes')({
  component: () => <RebuildGate feature="Agent runtimes" />,
});
