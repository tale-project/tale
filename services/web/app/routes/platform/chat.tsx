import { createFileRoute } from '@tanstack/react-router';

import { ChatPage } from '@/app/pages/platform/chat-page';

export const Route = createFileRoute('/platform/chat')({
  component: ChatPage,
});
