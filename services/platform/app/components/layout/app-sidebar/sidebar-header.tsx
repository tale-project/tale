'use client';

import { Link } from '@tanstack/react-router';
import type { MutableRefObject } from 'react';

import { useBrandingContext } from '@/app/components/branding/branding-provider';
import { TaleLogo } from '@/app/components/ui/logo/tale-logo';
import { cn } from '@/lib/utils/cn';

import { labelFadeClass } from './sidebar-motion';
import { SidebarToggle } from './sidebar-toggle';

export interface SidebarHeaderProps {
  organizationId: string;
  expanded: boolean;
  toggleFocusPendingRef: MutableRefObject<boolean>;
}

/**
 * Panel header: the org logo (32×32 box, links to a fresh chat — unchanged
 * behaviour from the old rail), the workspace name, and — while expanded —
 * the collapse toggle at the row's end. The logo occupies the leading 32px
 * icon column, so it lines up with every tile below in both states.
 */
export function SidebarHeader({
  organizationId,
  expanded,
  toggleFocusPendingRef,
}: SidebarHeaderProps) {
  const { appName } = useBrandingContext();
  const workspaceName = appName ?? 'Tale';

  return (
    <div className="flex h-8 items-center gap-2.5">
      <Link
        to="/dashboard/$id/chat"
        params={{ id: organizationId }}
        aria-label={workspaceName}
        className="focus-visible:ring-ring shrink-0 rounded-md focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
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
      {expanded && (
        <SidebarToggle
          focusPendingRef={toggleFocusPendingRef}
          placement="header"
        />
      )}
    </div>
  );
}
