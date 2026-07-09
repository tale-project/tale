import { createFileRoute } from '@tanstack/react-router';

import { ChatPage } from '@/app/pages/platform/chat-page';

export const Route = createFileRoute('/$lang/platform/chat')({
  component: ChatPage,
});
