import { createFileRoute, Outlet } from '@tanstack/react-router';
import { ChatLayoutProvider } from '@/app/features/chat/context/chat-layout-context';

export const Route = createFileRoute('/dashboard/$id/chat')({
  component: ChatLayout,
});

function ChatLayout() {
  return (
    <ChatLayoutProvider>
      <Outlet />
    </ChatLayoutProvider>
  );
}
