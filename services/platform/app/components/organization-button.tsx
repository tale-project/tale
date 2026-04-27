'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { useParams } from '@tanstack/react-router';
import { Building2 } from 'lucide-react';
import { useMemo } from 'react';

import {
  DropdownMenu,
  type DropdownMenuGroup,
} from '@/app/components/ui/overlays/dropdown-menu';
import { OrganizationListPanel } from '@/app/features/organization/components/organization-list-panel';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

export interface OrganizationButtonProps {
  align?: 'start' | 'end';
  /** Optional label to show next to the icon (for mobile navigation) */
  label?: string;
  /** Optional custom tooltip text */
  tooltipText?: string;
}

export function OrganizationButton({
  align = 'start',
  label,
  tooltipText,
}: OrganizationButtonProps) {
  const { t: tNav } = useT('navigation');
  const { user } = useAuth();
  const params = useParams({ strict: false });
  const organizationId = params.id ?? null;

  const menuItems = useMemo<DropdownMenuGroup[]>(() => {
    if (!user) return [];
    return [
      [
        {
          type: 'custom',
          content: (
            <OrganizationListPanel currentOrganizationId={organizationId} />
          ),
        },
      ],
    ];
  }, [user, organizationId]);

  if (!user) return null;

  const accessibleLabel = tooltipText ?? tNav('orgSwitcher.label');

  const triggerContent = (
    <button
      type="button"
      aria-label={label ? undefined : accessibleLabel}
      className={cn(
        'relative flex items-center rounded-lg transition-colors hover:bg-muted cursor-pointer',
        label ? 'gap-3 px-3 py-2 w-full' : 'justify-center p-2',
      )}
    >
      <Building2 className="text-muted-foreground size-5 shrink-0" />
      {label && (
        <span className="text-sm leading-none font-medium">{label}</span>
      )}
    </button>
  );

  if (label) {
    return (
      <DropdownMenu
        trigger={triggerContent}
        items={menuItems}
        align={align}
        contentClassName="w-80"
      />
    );
  }

  return (
    <TooltipPrimitive.Provider delayDuration={300}>
      <TooltipPrimitive.Root>
        <DropdownMenu
          trigger={
            <TooltipPrimitive.Trigger asChild>
              {triggerContent}
            </TooltipPrimitive.Trigger>
          }
          items={menuItems}
          align={align}
          contentClassName="w-80"
        />
        <TooltipPrimitive.Content
          side="right"
          sideOffset={4}
          className="bg-foreground text-background animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 z-[60] overflow-hidden rounded-lg border p-2 py-1 text-xs shadow-md"
        >
          {accessibleLabel}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
