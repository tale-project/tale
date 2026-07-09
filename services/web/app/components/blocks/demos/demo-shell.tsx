import { cn } from '@tale/ui/cn';
import { TaleLogo } from '@tale/ui/logo';
import {
  Bell,
  Bot,
  Brain,
  CircleUser,
  Folder,
  Lock,
  MessageCircle,
  MoreHorizontal,
  Search,
  Settings,
  Share,
  SquarePen,
  Workflow,
} from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The address every demo window shows — a placeholder domain that quietly
 * makes the self-hosted point: this is YOUR deployment, not our cloud.
 */
const DEMO_ORIGIN = 'tale.yourcompany.com';

/**
 * The app's primary navigation, in sidebar order — mirrors
 * services/platform/app/hooks/use-navigation-items.ts so the marketing
 * frame stays a 1:1 depiction of the product.
 */
const NAV_ICONS = [MessageCircle, Folder, Brain, Bot, Workflow] as const;

export type DemoNav =
  | 'chat'
  | 'projects'
  | 'knowledge'
  | 'agents'
  | 'automations';

const NAV_INDEX: Record<DemoNav, number> = {
  chat: 0,
  projects: 1,
  knowledge: 2,
  agents: 3,
  automations: 4,
};

export interface DemoShellProps {
  /** Localized one-sentence description of what the demo shows. */
  label: string;
  /** Localized window-title text shown in the top bar. */
  title: string;
  /** Which sidebar item the depicted screen belongs to. */
  activeNav: DemoNav;
  /**
   * Sizing classes — include an `aspect-*` utility so the box is reserved
   * before any content mounts (CLS 0).
   */
  className?: string;
  children: ReactNode;
}

/**
 * 1:1 frame of the Tale app around every product demo: the icon nav rail
 * (logo mark, the five primary destinations, settings; notifications +
 * account at the bottom) and the thin top bar with Share/actions — matching
 * the real screens in services/docs/public/images/platform/. The frame is
 * one labelled image for assistive tech (`role="img"` + `aria-label`); the
 * animated UI inside is presentational (`aria-hidden`).
 */
export function DemoShell({
  label,
  title,
  activeNav,
  className,
  children,
}: DemoShellProps) {
  const activeIndex = NAV_INDEX[activeNav];

  return (
    <figure
      role="img"
      aria-label={label}
      className={cn(
        'border-border-base bg-surface-site-raised ring-border-base/60 m-0 flex w-full flex-col overflow-hidden rounded-xl border shadow-2xl ring-1',
        className,
      )}
    >
      {/* Browser chrome — Tale is a web app on YOUR domain. */}
      <div
        aria-hidden
        className="border-border-base bg-surface-site relative flex shrink-0 items-center border-b px-3 py-2"
      >
        <span className="flex items-center gap-1.5">
          <span className="bg-border-strong/70 size-2.5 rounded-full" />
          <span className="bg-border-strong/50 size-2.5 rounded-full" />
          <span className="bg-border-strong/30 size-2.5 rounded-full" />
        </span>
        <span className="border-border-base bg-surface-site-inset text-fg-subtle absolute left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px]">
          <Lock className="size-3" strokeWidth={1.75} />
          {DEMO_ORIGIN}
        </span>
      </div>

      <div aria-hidden className="flex min-h-0 min-w-0 flex-1">
        {/* Icon nav rail — the app's left edge. */}
        <div className="border-border-base bg-surface-site flex w-10 shrink-0 flex-col items-center gap-1 border-r py-3 md:w-13">
          <TaleLogo
            wordmark={false}
            className="text-fg-base mb-2 size-4 md:size-5"
          />
          {NAV_ICONS.map((Icon, index) => (
            <span
              key={index}
              className={cn(
                'flex size-7 items-center justify-center rounded-lg md:size-8',
                index === activeIndex
                  ? 'bg-surface-site-inset text-fg-base'
                  : 'text-fg-subtle',
              )}
            >
              <Icon className="size-3.5 md:size-4" strokeWidth={1.75} />
            </span>
          ))}
          <span className="text-fg-subtle flex size-7 items-center justify-center md:size-8">
            <Settings className="size-3.5 md:size-4" strokeWidth={1.75} />
          </span>
          <span className="text-fg-subtle mt-auto flex flex-col items-center gap-2">
            <Bell className="size-3.5 md:size-4" strokeWidth={1.75} />
            <CircleUser className="size-4 md:size-4.5" strokeWidth={1.75} />
          </span>
        </div>

        {/* Content column: top bar + screen. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-border-base flex shrink-0 items-center gap-2.5 border-b px-3 py-2 md:px-4">
            <SquarePen className="text-fg-subtle size-3.5" strokeWidth={1.75} />
            <Search className="text-fg-subtle size-3.5" strokeWidth={1.75} />
            <span className="text-fg-subtle ml-1 truncate text-xs">
              {title}
            </span>
            <span className="text-fg-subtle ml-auto flex items-center gap-2.5">
              <Share className="size-3.5" strokeWidth={1.75} />
              <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
            </span>
          </div>
          <div className="min-h-0 flex-1">{children}</div>
        </div>
      </div>
    </figure>
  );
}
