import { createFileRoute } from '@tanstack/react-router';

import { ConversationsPage } from '@/app/pages/platform/conversations-page';

export const Route = createFileRoute('/platform/conversations')({
  component: ConversationsPage,
});
