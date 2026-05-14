'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Skeleton } from '@tale/ui/skeleton';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import {
  LogOut,
  HelpCircle,
  Monitor,
  Sun,
  Moon,
  UserCircle,
  UsersRound,
  Languages,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { useTheme } from '@/app/components/theme/theme-provider';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Tabs } from '@/app/components/ui/navigation/tabs';
import {
  DropdownMenu,
  type DropdownMenuItem,
  type DropdownMenuGroup,
} from '@/app/components/ui/overlays/dropdown-menu';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Text } from '@/app/components/ui/typography/text';
import { useChangelogNotification } from '@/app/hooks/use-changelog-notification';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { useLocale } from '@/app/hooks/use-locale';
import { useOptionalTeamFilter } from '@/app/hooks/use-team-filter';
import { toast } from '@/app/hooks/use-toast';
import { getEnv } from '@/lib/env';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

export interface UserButtonProps {
  align?: 'start' | 'end';
  /** Optional label to show next to the icon (for mobile navigation) */
  label?: string;
  /** Optional custom tooltip text (defaults to "Manage account") */
  tooltipText?: string;
}

export function UserButton({
  align = 'start',
  label,
  tooltipText,
}: UserButtonProps) {
  const { t } = useT('auth');
  const { t: tNav } = useT('navigation');
  const { user, signOut, isLoading: loading } = useAuth();
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const organizationId = params.id;
  const { theme, setTheme } = useTheme();
  const { locale, setLocale } = useLocale();
  const teamFilter = useOptionalTeamFilter();
  const teams = teamFilter?.teams;
  const selectedTeamId = teamFilter?.selectedTeamId ?? null;
  const setSelectedTeamId = teamFilter?.setSelectedTeamId;

  const {
    currentVersion,
    lastSeenVersion,
    hasUnseenVersion,
    markSeen: markChangelogSeen,
  } = useChangelogNotification();

  const { data: memberContext } = useCurrentMemberContext(
    organizationId,
    !user,
  );

  const [signOutDialogOpen, setSignOutDialogOpen] = useState(false);

  const handleSignOut = useCallback(async () => {
    try {
      await signOut();
      // IMPORTANT: Do NOT replace with router.push('/')!
      // Must use window.location.href for hard navigation to immediately stop
      // all React rendering. Using router.push causes a race condition where
      // queries (member, approvals, threads, etc.) fire with stale auth state
      // before navigation completes, resulting in "Unauthenticated" errors.
      window.location.href = getEnv('BASE_PATH') || '/';
    } catch {
      toast({
        title: t('userButton.toast.signOutFailed'),
        variant: 'destructive',
      });
    }
  }, [signOut, t]);

  const handleSignOutClick = useCallback(() => {
    setSignOutDialogOpen(true);
  }, []);

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
                  <Text className="font-semibold">{displayName}</Text>
                  {displayName !== user.email && (
                    <Text variant="muted">{user.email}</Text>
                  )}
                  {currentVersion && (
                    <Text variant="muted" className="text-xs">
                      {t('userButton.currentVersion', {
                        version: currentVersion,
                      })}
                      {' · '}
                      <Link
                        to="/dashboard/changelog"
                        search={{
                          from: lastSeenVersion,
                          to: currentVersion,
                        }}
                        onClick={markChangelogSeen}
                        className="text-foreground relative inline-flex cursor-pointer items-center underline underline-offset-2 hover:opacity-80"
                      >
                        {t('userButton.whatsNew')}
                        {hasUnseenVersion && (
                          <>
                            <span className="sr-only">
                              {t('userButton.updateAvailable')}
                            </span>
                            <span
                              className="ml-1.5 size-1.5 rounded-full bg-red-500"
                              aria-hidden="true"
                            />
                          </>
                        )}
                      </Link>
                    </Text>
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
      const settingsGroup: DropdownMenuItem[] = [];

      if (teams && teams.length > 0) {
        const selectedTeamLabel = selectedTeamId
          ? (teams.find((team) => team.id === selectedTeamId)?.name ??
            tNav('teamFilter.allTeams'))
          : tNav('teamFilter.allTeams');

        settingsGroup.push({
          type: 'sub',
          label: tNav('teamFilter.label'),
          icon: UsersRound,
          trailing: selectedTeamLabel,
          items: [
            [
              {
                type: 'radio-group',
                value: selectedTeamId ?? '',
                onValueChange: (val) => {
                  setSelectedTeamId?.(val || null);
                  if (organizationId) {
                    void navigate({
                      to: '/dashboard/$id/chat',
                      params: { id: organizationId },
                    });
                  }
                },
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

      if (settingsGroup.length > 0) {
        groups.push(settingsGroup);
      }
    }

    groups.push([
      {
        type: 'custom',
        content: (
          <Tabs
            value={theme}
            onValueChange={(v) => {
              if (v === 'system' || v === 'light' || v === 'dark') {
                setTheme(v);
              }
            }}
            listClassName="w-full"
            triggerClassName="flex-1"
            items={[
              {
                value: 'system',
                label: <Monitor className="size-4" />,
                ariaLabel: t('userButton.themeSystem'),
              },
              {
                value: 'light',
                label: <Sun className="size-4" />,
                ariaLabel: t('userButton.themeLight'),
              },
              {
                value: 'dark',
                label: <Moon className="size-4" />,
                ariaLabel: t('userButton.themeDark'),
              },
            ]}
          />
        ),
      },
    ]);

    const localeBase = locale.split('-')[0];
    const currentLocaleValue =
      localeBase === 'de' ? 'de' : localeBase === 'fr' ? 'fr' : 'en';

    groups.push([
      {
        type: 'sub',
        label: t('userButton.language'),
        icon: Languages,
        items: [
          [
            {
              type: 'radio-group',
              value: currentLocaleValue,
              onValueChange: (val) => {
                if (val) setLocale(val);
              },
              options: [
                { value: 'en', label: t('userButton.languageEnglish') },
                { value: 'de', label: t('userButton.languageGerman') },
                { value: 'fr', label: t('userButton.languageFrench') },
              ],
            },
          ],
        ],
        className: 'py-2.5',
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
        onClick: handleSignOutClick,
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
    locale,
    t,
    tNav,
    navigate,
    setTheme,
    setLocale,
    setSelectedTeamId,
    handleSignOutClick,
    currentVersion,
    lastSeenVersion,
    markChangelogSeen,
    hasUnseenVersion,
  ]);

  const triggerContent = (
    <div
      className={cn(
        'relative flex items-center rounded-lg transition-colors hover:bg-muted cursor-pointer',
        label ? 'gap-3 px-3 py-2 w-full' : 'justify-center p-2',
      )}
    >
      <div className="relative">
        <UserCircle className="text-muted-foreground size-5 shrink-0" />
        {hasUnseenVersion && (
          <>
            <span className="sr-only">{t('userButton.updateAvailable')}</span>
            <span
              className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-red-500"
              aria-hidden="true"
            />
          </>
        )}
      </div>
      {label && (
        <Text as="span" variant="label">
          {label}
        </Text>
      )}
    </div>
  );

  const signOutConfirmDialog = (
    <ConfirmDialog
      open={signOutDialogOpen}
      onOpenChange={setSignOutDialogOpen}
      title={t('userButton.logOutConfirm.title')}
      description={t('userButton.logOutConfirm.description')}
      confirmText={t('userButton.logOutConfirm.confirm')}
      onConfirm={handleSignOut}
    />
  );

  if (label) {
    return (
      <>
        <DropdownMenu
          trigger={triggerContent}
          items={menuItems}
          align={align}
          contentClassName="w-64"
        />
        {signOutConfirmDialog}
      </>
    );
  }

  return (
    <>
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
            contentClassName="w-64"
          />
          <TooltipPrimitive.Content
            side="right"
            sideOffset={4}
            className="bg-foreground text-background animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 z-[60] overflow-hidden rounded-lg border p-2 py-1 text-xs shadow-md"
          >
            {tooltipText ?? t('userButton.manageAccount')}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Root>
      </TooltipPrimitive.Provider>
      {signOutConfirmDialog}
    </>
  );
}
