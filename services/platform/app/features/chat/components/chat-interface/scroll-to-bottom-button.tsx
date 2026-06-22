'use client';

import { Button } from '@tale/ui/button';
import { m, AnimatePresence } from 'framer-motion';
import { ArrowDown } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

interface ScrollToBottomButtonProps {
  show: boolean;
  onClick: () => void;
}

/**
 * The floating "scroll to bottom" affordance over the composer. Fades in via
 * AnimatePresence while the user is scrolled away from the latest message.
 * Fully prop-driven — the scroll state machine lives in `useChatScroll`.
 */
export function ScrollToBottomButton({
  show,
  onClick,
}: ScrollToBottomButtonProps) {
  const { t } = useT('chat');
  return (
    <AnimatePresence>
      {show && (
        <m.div
          initial={{ opacity: 0, y: 8, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.95 }}
          transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
          className="absolute -top-10 right-2 z-10 sm:right-0"
        >
          <Button
            onClick={onClick}
            size="icon"
            variant="secondary"
            className="bg-background/95 rounded-full shadow-lg backdrop-blur-xs"
            title={t('aria.scrollToBottom')}
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
        </m.div>
      )}
    </AnimatePresence>
  );
}
