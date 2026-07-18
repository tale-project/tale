'use client';

import { Link } from '@tanstack/react-router';

import { useBrandingContext } from '@/app/components/branding/branding-provider';
import { TaleLogo } from '@/app/components/ui/logo/tale-logo';
import { cn } from '@/lib/utils/cn';

import { labelFadeClass, TOGGLE_SLIDE_CLASS } from './sidebar-motion';
import { SidebarToggle } from './sidebar-toggle';

export interface SidebarHeaderProps {
  organizationId: string;
  expanded: boolean;
  /**
   * Whether the sidebar can be expanded at this viewport. When false (the
   * `md`–`lg` pinned rail) there is no toggle — the logo takes the leading
   * slot instead.
   */
  collapsible: boolean;
}

/**
 * Panel header. Expanded: the org logo (32×32 box, links to a fresh chat),
 * the workspace name, and the collapse toggle at the row's end. Collapsed:
 * only the toggle in the leading icon column — except on the pinned rail
 * (not `collapsible`), which shows the logo there instead. One toggle
 * instance slides between its two positions on the panel's own 250ms curve —
 * the same distance the panel edge travels — so it reads as pinned to that
 * edge, while the logo and name crossfade beneath it.
 */
export function SidebarHeader({
  organizationId,
  expanded,
  collapsible,
}: SidebarHeaderProps) {
  const { appName } = useBrandingContext();
  const workspaceName = appName ?? 'Tale';
  const logoVisible = expanded || !collapsible;

  return (
    <div className="relative flex h-8 items-center gap-2.5">
      <Link
        to="/dashboard/$id/chat"
        params={{ id: organizationId }}
        aria-label={workspaceName}
        inert={!logoVisible || undefined}
        aria-hidden={!logoVisible}
        className={cn(
          'focus-visible:ring-ring shrink-0 rounded-md focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none',
          labelFadeClass(logoVisible),
        )}
      >
        <TaleLogo />
      </Link>
      <span
        aria-hidden
        className={cn(
          'text-foreground min-w-0 flex-1 truncate text-sm font-semibold',
          labelFadeClass(expanded),
        )}
      >
        {workspaceName}
      </span>
      {/* In-flow stand-in for the slot the toggle overlays while expanded, so
          the name truncates before running under it. */}
      <span aria-hidden className="w-8 shrink-0" />
      {collapsible && (
        <div
          className={cn('absolute top-0 left-0', TOGGLE_SLIDE_CLASS)}
          style={{
            transform: expanded
              ? 'translateX(calc(var(--sidebar-width, 16rem) - 1rem - 2rem))'
              : 'translateX(0)',
          }}
        >
          <SidebarToggle />
        </div>
      )}
    </div>
  );
}
