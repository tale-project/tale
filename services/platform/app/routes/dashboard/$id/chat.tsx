import { createFileRoute, Outlet } from '@tanstack/react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChatLayoutProvider,
  useChatLayout,
} from '@/app/features/chat/context/chat-layout-context';
import { ChatHeader } from '@/app/features/chat/components/chat-header';
import { ChatHistorySidebar } from '@/app/features/chat/components/chat-history-sidebar';
import { LayoutErrorBoundary } from '@/app/components/error-boundaries/boundaries/layout-error-boundary';

export const Route = createFileRoute('/dashboard/$id/chat')({
  component: ChatLayout,
});

function ChatLayoutContent({ organizationId }: { organizationId: string }) {
  const { isHistoryOpen } = useChatLayout();

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full bg-background overflow-hidden">
      <ChatHeader organizationId={organizationId} />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <AnimatePresence initial={false}>
          {isHistoryOpen && (
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: '18rem' }}
              exit={{ width: 0 }}
              transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
              className="hidden md:flex flex-col w-[18rem] border-r border-border overflow-hidden bg-background"
            >
              <ChatHistorySidebar organizationId={organizationId} />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <LayoutErrorBoundary organizationId={organizationId}>
            <Outlet />
          </LayoutErrorBoundary>
        </div>
      </div>
    </div>
  );
}

function ChatLayout() {
  const { id: organizationId } = Route.useParams();

  return (
    <ChatLayoutProvider>
      <ChatLayoutContent organizationId={organizationId} />
    </ChatLayoutProvider>
  );
}
