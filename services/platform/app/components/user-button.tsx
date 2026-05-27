'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useInstallPrompt } from '@tale/ui/pwa/use-install-prompt';
import { Skeleton } from '@tale/ui/skeleton';
import { Tabs } from '@tale/ui/tabs';
import { Text } from '@tale/ui/text';
import { useTheme } from '@tale/ui/theme';
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
  Building2,
  Settings as SettingsIcon,
  Bell,
  Download,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { NotificationListPanel } from '@/app/features/notifications/components/notification-list-panel';
import { useNotificationsUnreadCount } from '@/app/features/notifications/hooks/queries';
import { OrganizationListPanel } from '@/app/features/organization/components/organization-list-panel';
import { useUserOrganizationsWithDetails } from '@/app/features/organization/hooks/queries';
import { useChangelogNotification } from '@/app/hooks/use-changelog-notification';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { useOptionalTeamFilter } from '@/app/hooks/use-team-filter';
import { toast } from '@/app/hooks/use-toast';
import { getEnv } from '@/lib/env';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

// Native flag emojis for the language switcher. Keyed by the locale code that
// `setLocale` accepts. Rendered next to the language name (which itself comes
// from `global.languages.*`, always in the language's own name).
const LANGUAGE_FLAGS: Record<string, string> = {
  en: '\u{1F1FA}\u{1F1F8}', // US
  de: '\u{1F1E9}\u{1F1EA}', // DE
  fr: '\u{1F1EB}\u{1F1F7}', // FR
};

export interface UserButtonProps {
  align?: 'start' | 'end';
  /** Optional label to show next to the icon (for mobile navigation) */
  label?: string;
  /** Optional custom tooltip text (defaults to "Manage account") */
  tooltipText?: string;
  /**
   * Called whenever a dropdown item navigates to a different route. Lets a
   * parent surface (e.g. the mobile navigation Sheet) close itself so the
   * destination page isn't covered by a stale overlay. Theme / locale /
   * org-switcher toggles deliberately do NOT call this — they don't change
   * the current route.
   */
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
  const { t: tGlobal } = useT('global');
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
  // UserButton renders inside the dashboard layout, which always has an
  // `organizationId` in route params — but the type from `useParams({ strict:
  // false })` is `string | undefined`, so cast for the typed hook.
  const { data: notificationsUnread } = useNotificationsUnreadCount(
    organizationId ?? '',
  );
  const unreadCount = notificationsUnread ?? 0;
  // PWA install — `canInstall` is only true on browsers that fired
  // `beforeinstallprompt` AND when the app isn't already installed, so the
  // "Get app" row stays hidden everywhere else (iOS Safari, Firefox, etc.).
  const { canInstall, promptInstall } = useInstallPrompt();

  const handleInstallApp = useCallback(() => {
    void promptInstall();
  }, [promptInstall]);

  // Used to display the current org name in the dropdown trigger row.
  const { organizations: userOrgs } = useUserOrganizationsWithDetails();
  const currentOrg = userOrgs?.find((o) => o.organizationId === organizationId);

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
  const [open, setOpen] = useState(false);
  // Profile dropdown swaps its content between the default view and a
  // notifications view in-place (no second popover). When it closes, reset
  // to the default so reopening always starts at the profile.
  const [view, setView] = useState<'profile' | 'notifications'>('profile');

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setView('profile');
  }, []);

  const handleOpenNotifications = useCallback(() => {
    setView('notifications');
  }, []);

  const handleBackToProfile = useCallback(() => {
    setView('profile');
  }, []);

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
    // Notifications view — replaces the entire dropdown content with the
    // notifications list (a back chevron in the list header swaps back).
    // Width and padding adjust via `contentClassName` below.
    if (view === 'notifications' && organizationId) {
      return [
        [
          {
            type: 'custom',
            content: (
              <div className="animate-in fade-in-0 slide-in-from-right-1 duration-150">
                <NotificationListPanel
                  organizationId={organizationId}
                  onBack={handleBackToProfile}
                  className="h-[28rem]"
                />
              </div>
            ),
          },
        ],
      ];
    }

    const groups: DropdownMenuGroup[] = [];

    groups.push([
      {
        type: 'label',
        content: (
          <div className="flex items-start justify-between gap-2">
            <Tooltip
              content={
                !loading && user && memberContext?.role
                  ? `${displayName} - ${memberContext.role}`
                  : null
              }
              side="top"
            >
              <div className="flex min-w-0 flex-1 cursor-default flex-col gap-1">
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
            {organizationId && (
              <button
                type="button"
                onClick={handleOpenNotifications}
                aria-label={tNav('notifications')}
                className="hover:bg-muted relative -my-0.5 flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
              >
                <Bell className="text-muted-foreground size-4" />
                {unreadCount > 0 && (
                  <span
                    aria-hidden
                    className="bg-destructive text-destructive-foreground absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold"
                  >
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
            )}
          </div>
        ),
        className: 'pb-3 font-normal',
      },
    ]);

    if (!loading && user && organizationId) {
      // Organization switcher — uses a sub-menu so the dropdown stays
      // compact for users with many orgs. The trigger row shows the current
      // org name; opening the sub reveals the full searchable / scrollable
      // panel of organizations.
      const currentOrgName = currentOrg?.name ?? tNav('orgSwitcher.label');
      groups.push([
        {
          type: 'sub',
          label: currentOrgName,
          icon: Building2,
          items: [
            [
              {
                type: 'custom',
                content: (
                  <OrganizationListPanel
                    currentOrganizationId={organizationId}
                  />
                ),
              },
            ],
          ],
          className: 'py-2.5',
          contentClassName: 'min-w-72',
        },
      ]);

      // Team filter — also a sub-menu so a user with many teams isn't faced
      // with a 50-row dropdown. The trigger shows the currently selected
      // team; the sub-menu has the full list.
      if (teams && teams.length > 0) {
        const selectedTeamName = selectedTeamId
          ? (teams.find((team) => team.id === selectedTeamId)?.name ??
            tNav('teamFilter.allTeams'))
          : tNav('teamFilter.allTeams');

        groups.push([
          {
            type: 'sub',
            label: selectedTeamName,
            icon: UsersRound,
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
                      onNavigate?.();
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
            contentClassName: 'min-w-72',
          },
        ]);
      }

      // Settings entry points — split between user-scoped settings (account,
      // personalization) and organization-scoped settings (everything else).
      // Use `onClick` + `navigate()` instead of `href` so TanStack Router
      // does client-side navigation; an `<a href>` would full-reload.
      groups.push([
        {
          type: 'item',
          label: tNav('userSettings'),
          icon: SettingsIcon,
          onClick: () => {
            void navigate({
              to: '/dashboard/$id/settings/personal',
              params: { id: organizationId },
            });
            onNavigate?.();
          },
          className: 'py-2.5',
        },
        {
          type: 'item',
          label: tNav('orgSettings'),
          icon: Building2,
          onClick: () => {
            void navigate({
              to: '/dashboard/$id/settings',
              params: { id: organizationId },
            });
            onNavigate?.();
          },
          className: 'py-2.5',
        },
      ]);
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

    // Language switcher — each option's label combines its country flag and
    // the language name as written in that language (from `global.languages`,
    // which is locale-invariant — i.e. "English" / "Deutsch" / "Français"
    // regardless of the active locale).
    const renderLanguageOption = (value: 'en' | 'de' | 'fr') => (
      <span className="flex items-center gap-2">
        <span aria-hidden="true">{LANGUAGE_FLAGS[value]}</span>
        <span>{tGlobal(`languages.${value}`)}</span>
      </span>
    );

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
                { value: 'en', label: renderLanguageOption('en') },
                { value: 'de', label: renderLanguageOption('de') },
                { value: 'fr', label: renderLanguageOption('fr') },
              ],
            },
          ],
        ],
        className: 'py-2.5',
      },
    ]);

    const helpGroup: DropdownMenuGroup = [];
    if (canInstall) {
      helpGroup.push({
        type: 'item',
        label: t('userButton.getApp'),
        icon: Download,
        onClick: handleInstallApp,
        className: 'py-2.5',
      });
    }
    helpGroup.push(
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
    );
    groups.push(helpGroup);

    return groups;
  }, [
    view,
    loading,
    user,
    memberContext,
    displayName,
    organizationId,
    currentOrg,
    teams,
    selectedTeamId,
    theme,
    locale,
    t,
    tNav,
    tGlobal,
    navigate,
    setTheme,
    setLocale,
    setSelectedTeamId,
    handleSignOutClick,
    handleOpenNotifications,
    handleBackToProfile,
    handleInstallApp,
    canInstall,
    unreadCount,
    currentVersion,
    lastSeenVersion,
    markChangelogSeen,
    hasUnseenVersion,
    onNavigate,
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
        {(hasUnseenVersion || unreadCount > 0) && (
          <>
            <span className="sr-only">
              {unreadCount > 0
                ? tNav('notifications')
                : t('userButton.updateAvailable')}
            </span>
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

  // Width transitions between the compact profile view and the wider
  // notifications view so the side-extension swap feels continuous.
  // `max-w-[calc(100vw-2rem)]` keeps the wider variant inside the viewport
  // on small screens.
  const contentClassName = cn(
    'transition-[width,max-width] duration-200',
    view === 'notifications' ? 'w-96 max-w-[calc(100vw-2rem)] p-0' : 'w-64',
  );

  if (label) {
    return (
      <>
        <DropdownMenu
          trigger={triggerContent}
          items={menuItems}
          align={align}
          open={open}
          onOpenChange={handleOpenChange}
          contentClassName={contentClassName}
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
            open={open}
            onOpenChange={handleOpenChange}
            contentClassName={contentClassName}
          />
          <TooltipPrimitive.Content
            side="right"
            sideOffset={4}
            className="bg-foreground text-background animate-in fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 z-[60] overflow-hidden rounded-lg border p-2 py-1 text-xs shadow-md"
          >
            {tooltipText ?? t('userButton.manageAccount')}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Root>
      </TooltipPrimitive.Provider>
      {signOutConfirmDialog}
    </>
  );
}
