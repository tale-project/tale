import { createFileRoute } from '@tanstack/react-router';

import { ConversationsPage } from '@/app/pages/platform/conversations-page';

export const Route = createFileRoute('/$lang/platform/conversations')({
  component: ConversationsPage,
});
