import {
  AdaptiveHeaderProvider,
  AdaptiveHeaderSlot,
} from '@tale/ui/adaptive-header';
import { useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { MAIN_CONTENT_ID } from '@/app/lib/main-area';
import { hasOwnPhoneHeader } from '@/app/lib/own-phone-header';

import { AppRail } from './app-rail';
import { Banners } from './banners';
import { MobileNav } from './mobile-nav';

/**
 * The frame of every page: the rail beside the page on a desktop, the tab bar
 * under it on a phone, and the mobile header (the page's title, through the
 * adaptive header slot) above it. Pages bring their own `PageLayout`.
 *
 * That bar is for the title a page puts in the slot. A page that puts none (the
 * page of a session, which brings a header of its own, and the page that says
 * there is no page) has it left out, as the platform leaves out the bar of its
 * shell for a chat or a task (`threadPage` in `routes/dashboard/$id.tsx`):
 * else an empty row with a line under it would stand above the page's content.
 *
 * The notices of the whole app sit above the row of rail and page, not inside
 * `<main>`: nested there they pushed the page's header down while the rail
 * stayed put, and looked broken. Mirrors `routes/dashboard/$id.tsx` of the
 * platform (its alerts stand "above nav + main so page headers stay flush with
 * the rail").
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const withoutBar = useRouterState({
    select: ({ location, statusCode }) =>
      hasOwnPhoneHeader(location.pathname) || statusCode === 404,
  });
  return (
    <AdaptiveHeaderProvider>
      <div className="mobile-nav-shell flex h-dvh w-full flex-col overflow-hidden">
        <Banners />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          <AppRail />
          <main
            id={MAIN_CONTENT_ID}
            tabIndex={-1}
            className="border-border bg-background flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden outline-none md:border-l"
          >
            {!withoutBar && (
              <header className="bg-background border-border sticky top-0 z-40 shrink-0 border-b px-4 md:hidden">
                <div className="flex min-h-12 items-center">
                  <AdaptiveHeaderSlot />
                </div>
              </header>
            )}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {children}
            </div>
          </main>
          <MobileNav />
        </div>
      </div>
    </AdaptiveHeaderProvider>
  );
}
