import { createFileRoute } from '@tanstack/react-router';

import { RebuildGate } from '@/app/components/layout/rebuild-gate';

export const Route = createFileRoute('/dashboard/$id/chat/shared/$shareToken')({
  component: () => <RebuildGate feature="Chat" />,
});
