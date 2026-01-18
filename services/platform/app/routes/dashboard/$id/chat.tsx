import { createFileRoute, Outlet } from '@tanstack/react-router';
import { ChatLayoutProvider } from '@/app/features/chat/context/chat-layout-context';
import { ChatHeader } from '@/app/features/chat/components/chat-header';
import { LayoutErrorBoundary } from '@/app/components/error-boundaries/boundaries/layout-error-boundary';

export const Route = createFileRoute('/dashboard/$id/chat')({
  component: ChatLayout,
});

function ChatLayout() {
  const { id: organizationId } = Route.useParams();

  return (
    <ChatLayoutProvider>
      <div className="flex flex-col flex-1 min-h-0 h-full bg-background relative overflow-hidden">
        <ChatHeader organizationId={organizationId} />
        <LayoutErrorBoundary organizationId={organizationId}>
          <Outlet />
        </LayoutErrorBoundary>
      </div>
    </ChatLayoutProvider>
  );
}
