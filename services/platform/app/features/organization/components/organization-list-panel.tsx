'use client';

import { useLocation, useNavigate } from '@tanstack/react-router';
import { Check, Loader2, Plus } from 'lucide-react';
import { useCallback, useState } from 'react';

import { useUserOrganizationsWithDetails } from '@/app/features/organization/hooks/queries';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

interface OrganizationListPanelProps {
  currentOrganizationId: string | null;
  onAfterAction?: () => void;
  /**
   * Hide the "Organization" section header. Use when the panel is rendered
   * under a row that already labels it (e.g. the account menu's inline
   * Organization picker), where the header would be redundant.
   */
  hideHeader?: boolean;
}

export function OrganizationListPanel({
  currentOrganizationId,
  onAfterAction,
  hideHeader = false,
}: OrganizationListPanelProps) {
  const { t: tSettings } = useT('settings');
  const { t: tNav } = useT('navigation');
  const navigate = useNavigate();
  const location = useLocation();

  const { organizations: userOrgs } = useUserOrganizationsWithDetails();

  const [switchingOrgId, setSwitchingOrgId] = useState<string | null>(null);

  const switchToOrg = useCallback(
    (nextOrgId: string) => {
      if (nextOrgId === currentOrganizationId) {
        onAfterAction?.();
        return;
      }
      setSwitchingOrgId(nextOrgId);
      const subpath =
        location.href.match(/^\/dashboard\/[^/]+\/(.*)$/)?.[1] ?? '';
      void navigate({
        to: '/dashboard/switching',
        search: { to: nextOrgId, subpath: subpath || undefined },
        replace: true,
      });
      onAfterAction?.();
    },
    [currentOrganizationId, navigate, location.href, onAfterAction],
  );

  const orgs = userOrgs ?? [];

  return (
    <div className="flex flex-col">
      {!hideHeader && (
        <div className="text-muted-foreground px-3 pt-2 pb-1.5 text-xs font-medium tracking-wide uppercase">
          {tNav('orgSwitcher.label')}
        </div>
      )}

      <ul className="max-h-72 overflow-y-auto py-1">
        {orgs.map((org) => {
          const isCurrent = org.organizationId === currentOrganizationId;
          const isSwitching = switchingOrgId === org.organizationId;
          return (
            <li key={org.organizationId}>
              <button
                type="button"
                onClick={() => switchToOrg(org.organizationId)}
                disabled={isSwitching}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                  isCurrent
                    ? 'bg-muted'
                    : 'hover:bg-muted focus-visible:bg-muted',
                  isSwitching && 'opacity-60',
                )}
              >
                <span
                  className="bg-muted-foreground/15 text-foreground flex size-7 shrink-0 items-center justify-center rounded text-xs font-semibold"
                  aria-hidden="true"
                >
                  {org.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">
                    {org.name}
                  </span>
                  <span className="text-muted-foreground truncate text-xs">
                    {org.slug ? `@${org.slug} · ` : ''}
                    {org.role}
                  </span>
                </span>
                {isSwitching ? (
                  <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
                ) : isCurrent ? (
                  <Check className="text-foreground size-4 shrink-0" />
                ) : (
                  <span className="size-4 shrink-0" aria-hidden="true" />
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="border-border border-t p-1">
        <button
          type="button"
          onClick={() => {
            void navigate({ to: '/dashboard/create-organization' });
            onAfterAction?.();
          }}
          className="hover:bg-muted focus-visible:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
        >
          <Plus className="text-muted-foreground size-4 shrink-0" />
          <span>{tSettings('organization.createOrganization')}</span>
        </button>
      </div>
    </div>
  );
}
