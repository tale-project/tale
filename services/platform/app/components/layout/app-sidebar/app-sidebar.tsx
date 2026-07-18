'use client';

import { Stack } from '@tale/ui/layout';
import { m } from 'framer-motion';
import { useEffect, useRef } from 'react';

import { useIsMac } from '@/app/hooks/use-is-mac';
import { useIsMobile } from '@/app/hooks/use-is-mobile';
import { usePrefersReducedMotion } from '@/app/hooks/use-prefers-reduced-motion';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { MobileSidebarSheet } from './mobile-sidebar-sheet';
import { SidebarChats } from './sidebar-chats';
import { useSidebar } from './sidebar-context';
import { SidebarFooter } from './sidebar-footer';
import { SidebarHeader } from './sidebar-header';
import { PANEL_DURATION_S, PANEL_EASE } from './sidebar-motion';
import { SidebarNav } from './sidebar-nav';
import { SidebarSearch } from './sidebar-search';
import { SidebarSearchCommand } from './sidebar-search-command';
import { SidebarToggle } from './sidebar-toggle';

const EXPANDED_WIDTH = 'var(--sidebar-width, 18rem)';
const COLLAPSED_WIDTH = 'var(--sidebar-width-collapsed, 3.5rem)';

export interface AppSidebarProps {
  organizationId: string;
}

/**
 * The unified app sidebar: primary navigation, chat search, and chat history
 * in one shell-level panel present on every dashboard route. Expanded it is an
 * 18rem labelled panel; collapsed, a 3.5rem icon rail. The inner column keeps
 * the expanded width and the panel clips it, so icons hold their position and
 * the whole surface folds as one piece (rows animate their own width in sync —
 * see sidebar-motion.ts).
 *
 * Also owns the single ⌘H binding and mounts the surfaces that must exist on
 * every route regardless of viewport: the mobile drawer and the ⌘K palette.
 */
export function AppSidebar({ organizationId }: AppSidebarProps) {
  const { isExpanded, toggleExpanded, setMobileSheetOpen } = useSidebar();
  const { t: tNav } = useT('navigation');
  const prefersReducedMotion = usePrefersReducedMotion();
  const isMac = useIsMac();
  const isMobile = useIsMobile();
  // Handed to both toggle positions so the one that mounts after a click
  // reclaims keyboard focus (see SidebarToggle).
  const toggleFocusPendingRef = useRef(false);

  // ⌘H: desktop toggles the panel, mobile toggles the unified drawer. One
  // owner for the binding — the chat header no longer registers it.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMod = isMac ? e.metaKey : e.ctrlKey;
      if (isMod && !e.shiftKey && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault();
        e.stopPropagation();
        if (isMobile) {
          setMobileSheetOpen((prev) => !prev);
        } else {
          toggleExpanded();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isMac, isMobile, setMobileSheetOpen, toggleExpanded]);

  const transition = prefersReducedMotion
    ? { duration: 0 }
    : { duration: PANEL_DURATION_S, ease: PANEL_EASE };

  return (
    <>
      <aside
        aria-label={tNav('sidebar.landmark')}
        className="bg-background relative hidden h-full shrink-0 md:flex"
      >
        <m.div
          id="chat-history-panel"
          initial={false}
          animate={{ width: isExpanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH }}
          transition={transition}
          className="relative h-full overflow-hidden"
        >
          {/* Fixed-width inner column: the panel clips it instead of reflowing
              it, so nothing inside ever re-wraps mid-animation. */}
          <Stack
            gap={0}
            className="h-full overflow-hidden"
            style={{ width: EXPANDED_WIDTH }}
          >
            <div className="shrink-0 px-3 pt-3 pb-2">
              <SidebarHeader
                organizationId={organizationId}
                expanded={isExpanded}
                toggleFocusPendingRef={toggleFocusPendingRef}
              />
            </div>
            {/* Rail toggle slot: its height animates open in sync with the
                collapse (grid-rows trick) so the rows below slide rather than
                jump when the toggle repositions out of the header. */}
            <div
              className={cn(
                'grid shrink-0 transition-[grid-template-rows] duration-[250ms] ease-(--ease-out-quint) motion-reduce:transition-none',
                isExpanded ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]',
              )}
              aria-hidden={isExpanded}
              inert={isExpanded}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="px-3 pb-2">
                  <SidebarToggle
                    focusPendingRef={toggleFocusPendingRef}
                    placement="rail"
                  />
                </div>
              </div>
            </div>
            <div className="shrink-0 px-3 pb-2">
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
        </m.div>
      </aside>
      <MobileSidebarSheet organizationId={organizationId} />
      <SidebarSearchCommand organizationId={organizationId} />
    </>
  );
}
