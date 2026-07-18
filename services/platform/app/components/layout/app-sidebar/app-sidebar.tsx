'use client';

import { Stack } from '@tale/ui/layout';
import { useEffect } from 'react';

import { useIsDesktop } from '@/app/hooks/use-is-desktop';
import { useIsMac } from '@/app/hooks/use-is-mac';
import { useIsMobile } from '@/app/hooks/use-is-mobile';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { MobileSidebarSheet } from './mobile-sidebar-sheet';
import { SidebarChats } from './sidebar-chats';
import { useSidebar } from './sidebar-context';
import { SidebarFooter } from './sidebar-footer';
import { SidebarHeader } from './sidebar-header';
import { PANEL_TRANSITION_CLASS } from './sidebar-motion';
import { SidebarNav } from './sidebar-nav';
import { SidebarSearch } from './sidebar-search';
import { SidebarSearchCommand } from './sidebar-search-command';

const EXPANDED_WIDTH = 'var(--sidebar-width, 16rem)';
const COLLAPSED_WIDTH = 'var(--sidebar-width-collapsed, 3rem)';

export interface AppSidebarProps {
  organizationId: string;
}

/**
 * The unified app sidebar: primary navigation, chat search, and chat history
 * in one shell-level panel present on every dashboard route. Expanded it is an
 * 18rem labelled panel; collapsed, a 3.5rem icon rail. The inner column keeps
 * the expanded width and the panel clips it, so icons hold their position and
 * the whole surface folds as one piece — the panel, rows, toggle slide, and
 * fades all run on one CSS clock (see sidebar-motion.ts).
 *
 * Also owns the single ⌘H binding and mounts the surfaces that must exist on
 * every route regardless of viewport: the mobile drawer and the ⌘K palette.
 */
export function AppSidebar({ organizationId }: AppSidebarProps) {
  const {
    isExpanded: isExpandedPref,
    toggleExpanded,
    setMobileSheetOpen,
  } = useSidebar();
  const { t: tNav } = useT('navigation');
  const isMac = useIsMac();
  const isMobile = useIsMobile();
  // Between `md` and `lg` the panel is pinned to the icon rail: no toggle, no
  // ⌘H — there isn't room for the expanded panel beside the content. The
  // persisted preference is left untouched and reapplies on wide viewports.
  const collapsible = useIsDesktop();
  const isExpanded = isExpandedPref && collapsible;

  // ⌘H: wide desktop toggles the panel, mobile toggles the unified drawer. One
  // owner for the binding — the chat header no longer registers it.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMod = isMac ? e.metaKey : e.ctrlKey;
      if (isMod && !e.shiftKey && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault();
        e.stopPropagation();
        if (isMobile) {
          setMobileSheetOpen((prev) => !prev);
        } else if (collapsible) {
          toggleExpanded();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isMac, isMobile, collapsible, setMobileSheetOpen, toggleExpanded]);

  return (
    <>
      <aside
        aria-label={tNav('sidebar.landmark')}
        className="bg-background relative hidden h-full shrink-0 md:flex"
      >
        <div
          id="chat-history-panel"
          className={cn(
            'relative h-full overflow-hidden',
            PANEL_TRANSITION_CLASS,
          )}
          style={{ width: isExpanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH }}
        >
          {/* Fixed-width inner column: the panel clips it instead of reflowing
              it, so nothing inside ever re-wraps mid-animation. */}
          <Stack
            gap={0}
            className="h-full overflow-hidden"
            style={{ width: EXPANDED_WIDTH }}
          >
            <div className="shrink-0 px-2 pt-3 pb-4">
              <SidebarHeader
                organizationId={organizationId}
                expanded={isExpanded}
                collapsible={collapsible}
              />
            </div>
            <div className="shrink-0 px-2 pb-2">
              <SidebarSearch expanded={isExpanded} />
            </div>
            <SidebarNav organizationId={organizationId} expanded={isExpanded} />
            <SidebarChats
              organizationId={organizationId}
              expanded={isExpanded}
            />
            <SidebarFooter
              organizationId={organizationId}
              expanded={isExpanded}
            />
          </Stack>
        </div>
      </aside>
      <MobileSidebarSheet organizationId={organizationId} />
      <SidebarSearchCommand organizationId={organizationId} />
    </>
  );
}
