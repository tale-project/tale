import { createFileRoute, Outlet } from '@tanstack/react-router';
import { motion, AnimatePresence } from 'framer-motion';
import { PanelLeftClose } from 'lucide-react';

import { LayoutErrorBoundary } from '@/app/components/error-boundaries/boundaries/layout-error-boundary';
import { ChatHeader } from '@/app/features/chat/components/chat-header';
import { ChatHistorySidebar } from '@/app/features/chat/components/chat-history-sidebar';
import {
  ChatLayoutProvider,
  useChatLayout,
} from '@/app/features/chat/context/chat-layout-context';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/chat')({
  head: () => ({
    meta: seo('chat'),
  }),
  component: ChatLayout,
});

function ChatLayoutContent({ organizationId }: { organizationId: string }) {
  const { isHistoryOpen, setIsHistoryOpen } = useChatLayout();
  const { t: tChat } = useT('chat');

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
              className="relative hidden w-[18rem] shrink-0 md:block"
            >
              <div className="border-border bg-background flex h-full flex-col overflow-hidden border-r">
                <ChatHistorySidebar organizationId={organizationId} />
              </div>
              <button
                type="button"
                onClick={() => setIsHistoryOpen(false)}
                aria-label={tChat('hideHistory')}
                className="border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring absolute top-3 -right-3 z-10 flex size-6 items-center justify-center rounded-full border shadow-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                <PanelLeftClose className="size-3" />
              </button>
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
