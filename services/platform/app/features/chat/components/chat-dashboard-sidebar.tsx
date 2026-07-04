'use client';

import { Row, Stack } from '@tale/ui/layout';
import { Link, useLocation } from '@tanstack/react-router';
import { m } from 'framer-motion';
import { useCallback, useMemo } from 'react';

import { Navigation } from '@/app/components/ui/navigation/navigation';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { useAbility } from '@/app/hooks/use-ability';
import {
  useNavigationItems,
  type NavItem,
} from '@/app/hooks/use-navigation-items';
import { usePrefersReducedMotion } from '@/app/hooks/use-prefers-reduced-motion';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useChatLayout } from '../context/chat-layout-context';
import { ChatHistorySidebar } from './chat-history-sidebar';

const HISTORY_PANEL_WIDTH = 'var(--chat-history-width, 18rem)';

interface ChatDashboardSidebarProps {
  organizationId: string;
}

function MobileNavLink({
  item,
  onNavigate,
}: {
  item: NavItem;
  onNavigate: () => void;
}) {
  const location = useLocation();
  const ability = useAbility();
  const pathname = location.pathname;

  if (item.can && !ability.can(item.can[0], item.can[1])) {
    return null;
  }

  const isActive = item.isActivePath
    ? item.isActivePath(pathname)
    : pathname === item.href || pathname.startsWith(`${item.href}/`);

  const Icon = item.icon;
  const content = (
    <>
      {Icon && (
        <Icon
          className={cn(
            'size-5 shrink-0',
            isActive ? 'text-foreground' : 'text-muted-foreground',
          )}
          aria-hidden="true"
        />
      )}
      <span className="truncate text-sm font-medium">{item.label}</span>
    </>
  );

  const className = cn(
    'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
    'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
    isActive ? 'bg-muted text-foreground' : 'hover:bg-muted/60 text-foreground',
  );

  if (item.external) {
    return (
      <li>
        <a
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          className={className}
          onClick={onNavigate}
        >
          {content}
        </a>
      </li>
    );
  }

  return (
    <li>
      <Link
        to={item.to}
        params={item.params}
        preload="render"
        className={className}
        onClick={onNavigate}
      >
        {content}
      </Link>
    </li>
  );
}

function MobileNavigationList({
  organizationId,
  onNavigate,
}: {
  organizationId: string;
  onNavigate: () => void;
}) {
  const { t: tCommon } = useT('common');
  const { primary, pinned } = useNavigationItems(organizationId);
  const items = useMemo(() => [...primary, ...pinned], [primary, pinned]);

  return (
    <nav aria-label={tCommon('aria.mainNavigation')}>
      <ul role="list" className="flex flex-col gap-1 px-2 py-2">
        {items.map((item) => (
          <MobileNavLink key={item.href} item={item} onNavigate={onNavigate} />
        ))}
      </ul>
    </nav>
  );
}

export interface ChatMobileSidebarSheetProps {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Unified mobile drawer: primary nav destinations plus chat history. */
export function ChatMobileSidebarSheet({
  organizationId,
  open,
  onOpenChange,
}: ChatMobileSidebarSheetProps) {
  const { t } = useT('chat');
  const handleNavigate = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);
  const handleChatSelect = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      side="left"
      title={t('unifiedSidebar.title')}
      className="flex w-[min(100vw,20rem)] flex-col p-0 md:hidden"
      hideClose
    >
      <Stack gap={0} className="min-h-0 flex-1 overflow-hidden">
        <MobileNavigationList
          organizationId={organizationId}
          onNavigate={handleNavigate}
        />
        <div className="border-border min-h-0 flex-1 overflow-hidden border-t">
          <ChatHistorySidebar
            organizationId={organizationId}
            onChatSelect={handleChatSelect}
            className="h-full"
          />
        </div>
      </Stack>
    </Sheet>
  );
}

/**
 * Desktop unified left panel: icon nav rail plus an expandable chat-history
 * column. Collapsed state shows only the rail; expanded adds the history list.
 */
export function ChatDashboardSidebar({
  organizationId,
}: ChatDashboardSidebarProps) {
  const { isHistoryOpen } = useChatLayout();
  const { t } = useT('chat');
  const prefersReducedMotion = usePrefersReducedMotion();

  const transition = prefersReducedMotion
    ? { duration: 0 }
    : { duration: 0.3, ease: [0.25, 0.1, 0.25, 1] as const };

  return (
    <aside
      aria-label={t('unifiedSidebar.landmark')}
      className="bg-background relative hidden h-full shrink-0 md:flex"
    >
      <Row gap={0} align="stretch" className="border-border h-full border-r">
        <div className="h-full w-[var(--nav-size)] shrink-0 px-2">
          <Navigation organizationId={organizationId} />
        </div>

        <m.div
          id="chat-history-panel"
          initial={false}
          animate={{ width: isHistoryOpen ? HISTORY_PANEL_WIDTH : 0 }}
          transition={transition}
          className="relative overflow-hidden"
          aria-hidden={!isHistoryOpen}
        >
          <Stack
            gap={0}
            className="border-border bg-background h-full overflow-hidden border-l"
            style={{ width: HISTORY_PANEL_WIDTH }}
          >
            <ChatHistorySidebar organizationId={organizationId} />
          </Stack>
        </m.div>
      </Row>
    </aside>
  );
}
