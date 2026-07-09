import { cn } from '@tale/ui/cn';
import { TaleLogo } from '@tale/ui/logo';
import {
  Bell,
  Bot,
  BrainIcon,
  CircleUser,
  Ellipsis,
  Folder,
  Lock,
  MessageCircle,
  MessagesSquare,
  Search,
  Settings,
  Share,
  Workflow,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';

/**
 * The address every demo window shows — a placeholder domain that quietly
 * makes the self-hosted point: this is YOUR deployment, not our cloud.
 */
const DEMO_ORIGIN = 'tale.yourcompany.com';

/**
 * Primary nav in sidebar order — mirrors
 * services/platform/app/hooks/use-navigation-items.ts (Settings is last in
 * the primary list; notifications + account sit at the bottom).
 */
const NAV_ICONS = [
  MessageCircle,
  Folder,
  BrainIcon,
  Bot,
  Workflow,
  Settings,
] as const;

export type DemoNav =
  | 'chat'
  | 'projects'
  | 'knowledge'
  | 'agents'
  | 'automations'
  | 'settings';

const NAV_INDEX: Record<DemoNav, number> = {
  chat: 0,
  projects: 1,
  knowledge: 2,
  agents: 3,
  automations: 4,
  settings: 5,
};

/** Navs whose product page uses AdaptiveHeaderTitle (not chat-header). */
const PAGE_HEADER_NAVS = new Set<DemoNav>([
  'projects',
  'knowledge',
  'agents',
  'automations',
  'settings',
]);

export interface DemoShellProps {
  /** Localized one-sentence description of what the demo shows. */
  label: string;
  /**
   * Page title for AdaptiveHeaderTitle chrome (Agents, Knowledge, …).
   * Omit on chat demos — chat-header has no thread title.
   */
  title?: string;
  /** Which sidebar item the depicted screen belongs to. */
  activeNav: DemoNav;
  /**
   * Sizing classes — include an `aspect-*` utility so the box is reserved
   * before any content mounts (CLS 0).
   */
  className?: string;
  /**
   * `hero` uses the deeper elevation stack for the homepage product
   * window; `default` is the quieter tour-stage frame.
   */
  elevation?: 'default' | 'hero';
  children: ReactNode;
}

/**
 * 1:1 frame of the Tale app around every product demo — browser chrome,
 * icon nav rail, and the correct page header for the active nav.
 * Header + content share the same `surface-site` as the nav rail (product
 * `bg-background` idiom) — no raised strip under the title.
 */
export function DemoShell({
  label,
  title,
  activeNav,
  className,
  elevation = 'default',
  children,
}: DemoShellProps) {
  const { t } = useT('home');
  const activeIndex = NAV_INDEX[activeNav];
  const usePageHeader = PAGE_HEADER_NAVS.has(activeNav);

  return (
    <figure
      role="img"
      aria-label={label}
      className={cn(
        'border-border-base/70 bg-surface-site m-0 flex w-full flex-col overflow-hidden rounded-2xl border',
        'ring-1 ring-black/[0.03] dark:ring-white/[0.04]',
        elevation === 'hero' ? 'shadow-demo-hero' : 'shadow-demo',
        className,
      )}
    >
      {/* Browser chrome — marketing frame; the real app is a web deployment. */}
      <div
        aria-hidden
        className="border-border-base/60 bg-surface-site-inset/70 relative flex h-9 shrink-0 items-center border-b px-3 md:h-10 md:px-3.5"
      >
        <span className="flex items-center gap-1.5">
          <span className="bg-demo-traffic-close size-2.5 rounded-full" />
          <span className="bg-demo-traffic-min size-2.5 rounded-full" />
          <span className="bg-demo-traffic-max size-2.5 rounded-full" />
        </span>
        <span className="border-border-base/60 bg-surface-site text-fg-muted absolute left-1/2 flex max-w-[min(72%,22rem)] -translate-x-1/2 items-center gap-1.5 rounded-full border px-3 py-0.5 text-[11px]">
          <Lock className="size-3 shrink-0 opacity-70" strokeWidth={1.75} />
          <span className="truncate font-medium tracking-tight">
            {DEMO_ORIGIN}
          </span>
        </span>
      </div>

      <div aria-hidden className="flex min-h-0 min-w-0 flex-1">
        <div className="border-border-base/60 bg-surface-site flex w-11 shrink-0 flex-col items-center border-r md:w-14">
          <span className="flex shrink-0 items-center justify-center py-2.5 md:py-3">
            <TaleLogo
              wordmark={false}
              className="text-fg-base size-4 md:size-5"
            />
          </span>
          <span className="mx-0.5 flex min-h-0 flex-1 flex-col items-center justify-start gap-0.5 py-1 md:gap-1 md:py-2">
            {NAV_ICONS.map((Icon, index) => {
              const active = index === activeIndex;
              return (
                <span
                  key={index}
                  className={cn(
                    'flex shrink-0 items-center justify-center rounded-lg p-1.5 md:p-2',
                    active
                      ? 'bg-surface-site-inset text-fg-base'
                      : 'text-fg-muted',
                  )}
                >
                  <Icon
                    className="size-4 shrink-0 md:size-5"
                    strokeWidth={active ? 2 : 1.75}
                  />
                </span>
              );
            })}
          </span>
          <span className="text-fg-muted flex shrink-0 flex-col items-center gap-1 py-2 md:gap-2 md:py-3">
            <span className="relative flex items-center justify-center rounded-lg p-1.5 md:p-2">
              <Bell className="size-4 md:size-5" strokeWidth={1.75} />
              <span className="bg-brand-base absolute top-1.5 right-1.5 size-1.5 rounded-full md:top-2 md:right-2" />
            </span>
            <span className="bg-surface-site-inset text-fg-muted ring-border-base/50 flex size-6 items-center justify-center rounded-full ring-1 md:size-7">
              <CircleUser className="size-3.5 md:size-4" strokeWidth={1.75} />
            </span>
          </span>
        </div>

        {/* Main pane — same surface as the nav rail (product bg-background). */}
        <div className="bg-surface-site flex min-w-0 flex-1 flex-col">
          {usePageHeader ? (
            <div className="border-border-base/60 bg-surface-site flex h-11 shrink-0 items-center border-b px-3 md:h-13 md:px-4">
              <span className="text-fg-base truncate text-sm font-semibold tracking-tight md:text-base">
                {title}
              </span>
            </div>
          ) : (
            <div className="border-border-base/60 bg-surface-site flex h-11 shrink-0 items-center gap-0.5 border-b px-2.5 md:h-13 md:gap-1 md:px-3">
              <span className="text-fg-muted flex size-8 items-center justify-center rounded-lg">
                <MessagesSquare className="size-4" strokeWidth={1.75} />
              </span>
              <span className="text-fg-muted flex size-8 items-center justify-center rounded-lg">
                <Search className="size-4" strokeWidth={1.75} />
              </span>
              <span className="flex-1" />
              <span className="text-fg-muted ml-auto flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium">
                <Share className="size-4" strokeWidth={1.75} />
                <span className="hidden sm:inline">
                  {t('demos.chrome.share')}
                </span>
              </span>
              <span className="text-fg-muted flex size-8 items-center justify-center rounded-lg">
                <Ellipsis className="size-4" strokeWidth={1.75} />
              </span>
            </div>
          )}
          <div className="bg-surface-site min-h-0 flex-1 overflow-hidden">
            {children}
          </div>
        </div>
      </div>
    </figure>
  );
}
