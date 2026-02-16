'use client';

import { useNavigate, useParams } from '@tanstack/react-router';
import {
  LogOut,
  Settings,
  HelpCircle,
  Monitor,
  Sun,
  Moon,
  UserCircle,
  Building2,
} from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { useTheme } from '@/app/components/theme/theme-provider';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import {
  DropdownMenu,
  type DropdownMenuItem,
  type DropdownMenuGroup,
} from '@/app/components/ui/overlays/dropdown-menu';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

export interface UserButtonProps {
  align?: 'start' | 'end';
  /** Optional label to show next to the icon (for mobile navigation) */
  label?: string;
  /** Optional custom tooltip text (defaults to "Manage account") */
  tooltipText?: string;
  /** Callback when navigating (e.g., to close mobile nav) */
  onNavigate?: () => void;
}

export function UserButton({
  align = 'start',
  label,
  tooltipText,
  onNavigate,
}: UserButtonProps) {
  const { t } = useT('auth');
  const { t: tNav } = useT('navigation');
  const { user, signOut, isLoading: loading } = useAuth();
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const organizationId = params.id;
  const { theme, setTheme } = useTheme();
  const { teams, selectedTeamId, setSelectedTeamId } = useTeamFilter();

  const { data: memberContext } = useCurrentMemberContext(
    organizationId,
    !user,
  );

  const handleSignOut = useCallback(async () => {
    try {
      await signOut();
      // IMPORTANT: Do NOT replace with router.push('/')!
      // Must use window.location.href for hard navigation to immediately stop
      // all React rendering. Using router.push causes a race condition where
      // queries (member, approvals, threads, etc.) fire with stale auth state
      // before navigation completes, resulting in "Unauthenticated" errors.
      window.location.href = '/';
    } catch {
      toast({
        title: t('userButton.toast.signOutFailed'),
        variant: 'destructive',
      });
    }
  }, [signOut, t]);

  const displayName =
    memberContext?.displayName || user?.name || t('userButton.defaultName');

  const menuItems = useMemo<DropdownMenuGroup[]>(() => {
    const groups: DropdownMenuGroup[] = [];

    groups.push([
      {
        type: 'label',
        content: (
          <Tooltip
            content={
              !loading && user && memberContext?.role
                ? `${displayName} - ${memberContext.role}`
                : null
            }
            side="top"
          >
            <div className="flex cursor-default flex-col gap-1">
              {loading || !user ? (
                <>
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3.5 w-40" />
                </>
              ) : (
                <>
                  <p className="text-foreground text-sm font-semibold">
                    {displayName}
                  </p>
                  {displayName !== user.email && (
                    <p className="text-muted-foreground text-sm">
                      {user.email}
                    </p>
                  )}
                </>
              )}
            </div>
          </Tooltip>
        ),
        className: 'pb-3 font-normal',
      },
    ]);

    if (!loading && user && organizationId) {
      const settingsGroup: DropdownMenuItem[] = [
        {
          type: 'item',
          label: t('userButton.settings'),
          icon: Settings,
          onClick: () => {
            if (!organizationId) return;
            void navigate({
              to: '/dashboard/$id/settings',
              params: { id: organizationId },
            });
            onNavigate?.();
          },
          className: 'py-2.5',
        },
      ];

      if (teams && teams.length > 0) {
        settingsGroup.push({
          type: 'sub',
          label: tNav('teamFilter.label'),
          icon: Building2,
          items: [
            [
              {
                type: 'radio-group',
                value: selectedTeamId ?? '',
                onValueChange: (val) => setSelectedTeamId(val || null),
                options: [
                  { value: '', label: tNav('teamFilter.allTeams') },
                  ...teams.map((team) => ({
                    value: team.id,
                    label: team.name,
                  })),
                ],
              },
            ],
          ],
          className: 'py-2.5',
        });
      }

      groups.push(settingsGroup);
    }

    groups.push([
      {
        type: 'custom',
        content: (
          <div className="bg-secondary/20 flex items-center justify-between gap-2 rounded-lg p-1">
            <Button
              variant={theme === 'system' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setTheme('system')}
              className="flex-1"
            >
              <Monitor className="size-4" />
            </Button>
            <Button
              variant={theme === 'light' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setTheme('light')}
              className="flex-1"
            >
              <Sun className="size-4" />
            </Button>
            <Button
              variant={theme === 'dark' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setTheme('dark')}
              className="flex-1"
            >
              <Moon className="size-4" />
            </Button>
          </div>
        ),
      },
    ]);

    groups.push([
      {
        type: 'item',
        label: t('userButton.helpFeedback'),
        icon: HelpCircle,
        href: 'https://tale.dev/contact',
        external: true,
        className: 'py-2.5',
      },
      {
        type: 'item',
        label: t('userButton.logOut'),
        icon: LogOut,
        onClick: handleSignOut,
        disabled: loading || !user,
        className: 'py-2.5',
      },
    ]);

    return groups;
  }, [
    loading,
    user,
    memberContext,
    displayName,
    organizationId,
    teams,
    selectedTeamId,
    theme,
    t,
    tNav,
    navigate,
    onNavigate,
    setTheme,
    setSelectedTeamId,
    handleSignOut,
  ]);

  const triggerContent = (
    <div
      className={cn(
        'relative flex items-center rounded-lg transition-colors hover:bg-muted cursor-pointer',
        label ? 'gap-3 px-3 py-2 w-full' : 'justify-center p-2',
      )}
    >
      <UserCircle className="text-muted-foreground size-5 shrink-0" />
      {label && <span className="text-sm font-medium">{label}</span>}
    </div>
  );

  const trigger = label ? (
    triggerContent
  ) : (
    <Tooltip
      content={tooltipText ?? t('userButton.manageAccount')}
      side="right"
    >
      {triggerContent}
    </Tooltip>
  );

  return (
    <DropdownMenu
      trigger={trigger}
      items={menuItems}
      align={align}
      contentClassName="w-64"
    />
  );
}
