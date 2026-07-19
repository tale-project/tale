'use client';

import { Link } from '@tanstack/react-router';

import { useBrandingContext } from '@/app/components/branding/branding-provider';
import { TaleLogo } from '@/app/components/ui/logo/tale-logo';

export interface SidebarHeaderProps {
  organizationId: string;
}

/**
 * Rail header: the org logo as a 36×36 tile linking to a fresh chat. The
 * workspace name has no room on the rail — the logo's accessible name
 * carries it.
 */
export function SidebarHeader({ organizationId }: SidebarHeaderProps) {
  const { appName } = useBrandingContext();
  const workspaceName = appName ?? 'Tale';

  return (
    <Link
      to="/dashboard/$id/chat"
      params={{ id: organizationId }}
      aria-label={workspaceName}
      className="focus-visible:ring-ring inline-flex shrink-0 rounded-md focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
    >
      <TaleLogo />
    </Link>
  );
}
