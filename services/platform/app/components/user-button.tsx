'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useInstallPrompt } from '@tale/ui/pwa/use-install-prompt';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
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
  Download,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { IosInstallSheet } from '@/app/components/pwa/ios-install-sheet';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
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
  // PWA install — `canInstall` is true on browsers that fired
  // `beforeinstallprompt` (Chromium/Android), where we can prompt directly.
  // iOS can't install programmatically, so `isIOS` instead opens manual
  // "Add to Home Screen" instructions. Both stay hidden once installed and
  // on browsers with no install path (Firefox, desktop Safari).
  const { canInstall, isIOS, promptInstall } = useInstallPrompt();
  const [iosSheetOpen, setIosSheetOpen] = useState(false);

  const handleInstallApp = useCallback(() => {
    if (canInstall) {
      void promptInstall();
      return;
    }
    setIosSheetOpen(true);
  }, [canInstall, promptInstall]);

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

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
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
            <div className="flex min-w-0 flex-1 cursor-default flex-col gap-1">
              {/* One real label tree, masked while auth/member context loads.
                  Name + email are the dynamic leaves; the version row only
                  exists once loaded (it has no placeholder counterpart). */}
              <Skeletonize
                loading={loading || !user}
                label={t('userButton.defaultName')}
              >
                <Text className="font-semibold">
                  <SkeletonBox>
                    {!loading && user ? (
                      displayName
                    ) : (
                      <span className="inline-block h-4 w-32" />
                    )}
                  </SkeletonBox>
                </Text>
                {(loading || !user || displayName !== user.email) && (
                  <Text variant="muted">
                    <SkeletonBox>
                      {!loading && user ? (
                        user.email
                      ) : (
                        <span className="inline-block h-3.5 w-40" />
                      )}
                    </SkeletonBox>
                  </Text>
                )}
              </Skeletonize>
              {!loading && user && currentVersion && (
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
            </div>
          </Tooltip>
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
    if (canInstall || isIOS) {
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
    handleInstallApp,
    canInstall,
    isIOS,
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

  const overlays = (
    <>
      {signOutConfirmDialog}
      <IosInstallSheet open={iosSheetOpen} onOpenChange={setIosSheetOpen} />
    </>
  );

  const contentClassName = 'w-64';

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
        {overlays}
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
      {overlays}
    </>
  );
}
