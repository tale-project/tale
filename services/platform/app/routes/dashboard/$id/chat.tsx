import { createFileRoute, Outlet } from '@tanstack/react-router';
import { motion, AnimatePresence } from 'framer-motion';

import { LayoutErrorBoundary } from '@/app/components/error-boundaries/boundaries/layout-error-boundary';
import { ChatHeader } from '@/app/features/chat/components/chat-header';
import { ChatHistorySidebar } from '@/app/features/chat/components/chat-history-sidebar';
import {
  ChatLayoutProvider,
  useChatLayout,
} from '@/app/features/chat/context/chat-layout-context';

export const Route = createFileRoute('/dashboard/$id/chat')({
  component: ChatLayout,
});

function ChatLayoutContent({ organizationId }: { organizationId: string }) {
  const { isHistoryOpen } = useChatLayout();

  return (
    <div className="bg-background flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <ChatHeader organizationId={organizationId} />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <AnimatePresence initial={false}>
          {isHistoryOpen && (
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: '18rem' }}
              exit={{ width: 0 }}
              transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
              className="border-border bg-background hidden w-[18rem] flex-col overflow-hidden border-r md:flex"
            >
              <ChatHistorySidebar organizationId={organizationId} />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
