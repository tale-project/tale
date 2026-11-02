import { createFileRoute } from '@tanstack/react-router';

import { SessionsIndexPage } from '@/app/features/sessions/components/sessions-index-page';

export const Route = createFileRoute('/sessions/')({
  component: SessionsIndexPage,
});
