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
import { useIsMobile } from '@tale/ui/use-is-mobile';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import {
  LogOut,
  BookOpen,
  Monitor,
  Sun,
  Moon,
  UserCircle,
  UsersRound,
  Languages,
  Building2,
  Download,
  ChevronRight,
  Check,
} from 'lucide-react';
import {
  type ComponentType,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  labelFadeClass,
  ROW_TRANSITION_CLASS,
  rowWidthStyle,
} from '@/app/components/layout/app-sidebar/sidebar-motion';
import { IosInstallSheet } from '@/app/components/pwa/ios-install-sheet';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { OrganizationListPanel } from '@/app/features/organization/components/organization-list-panel';
import { useUserOrganizationsWithDetails } from '@/app/features/organization/hooks/queries';
import { TeamListPanel } from '@/app/features/settings/teams/components/team-list-panel';
import { useChangelogNotification } from '@/app/hooks/use-changelog-notification';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { useAuth } from '@/app/hooks/use-session-user';
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

/**
 * The current-selection pill shown after a picker row's static label (e.g. the
 * active org / team name). Shared by the mobile inline collapsible rows and the
 * desktop sub-menu triggers so both read identically.
 */
function MenuRowBadge({ children }: { children: ReactNode }) {
  return (
    <span className="bg-muted text-muted-foreground ml-auto max-w-[9rem] truncate rounded-full px-2 py-0.5 text-xs">
      {children}
    </span>
  );
}

interface MenuRowCollapsibleProps {
  icon: ComponentType<{ className?: string }>;
  /** Static primary label (e.g. "Organization", "Team", "Language"). */
  label: string;
  /**
   * Current selection, rendered as a small badge after the label — e.g. the
   * active org / team name. Omit for rows with no single current value.
   */
  badge?: string;
  children: ReactNode;
}

/**
 * A dropdown-menu row whose options expand inline, in place, pushing the rows
 * below it down — used for the wide org / team / language pickers.
 *
 * We deliberately do NOT use a side flyout here (Radix menu sub-menu or a
 * side-anchored Popover). The account menu sits hard against a screen edge
 * (right edge in the header, left edge in the sidebar), and a fixed-width
 * 18rem panel has nowhere to go: Radix runs `shift` before `flip`, so it
 * either clips off the far edge or slides behind the parent menu. Expanding
 * inline removes the second layer entirely, so the picker can never leak or
 * be occluded, on any viewport width.
 *
 * Lives inside an open DropdownMenu; the toggle row and option rows are plain
 * buttons (not menu items) and stop event propagation so a click expands /
 * selects without closing the menu.
 */
function MenuRowCollapsible({
  icon: Icon,
  label,
  badge,
  children,
}: MenuRowCollapsibleProps) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="focus:bg-accent hover:bg-accent flex w-full cursor-default items-center gap-2 rounded-md px-2 py-2.5 text-sm outline-none [&_svg]:size-4 [&_svg]:shrink-0"
      >
        <Icon />
        <span className="shrink-0">{label}</span>
        {badge != null && <MenuRowBadge>{badge}</MenuRowBadge>}
        <ChevronRight
          className={cn(
            'transition-transform',
            badge == null && 'ml-auto',
            open && 'rotate-90',
          )}
        />
      </button>
      {open && <div className="mt-0.5 mb-1 ml-2 border-l pl-2">{children}</div>}
    </div>
  );
}

export interface UserButtonProps {
  align?: 'start' | 'end';
  /**
   * Unified-sidebar footer variant. When set, the trigger renders as a
   * sidebar row — a 36px icon tile that widens to a full labelled row (the
   * member display name) while `true` — sharing the sidebar's width/fade
   * motion. The hover tooltip only renders while collapsed.
   */
  sidebarExpanded?: boolean;
}

export function UserButton({
  align = 'start',
  sidebarExpanded,
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
  // The org / team / language pickers expand inline on mobile (no room for a
  // side flyout against the screen edge) but use Radix sub-menu popups on
  // larger screens, where there's space to anchor them.
  const isMobile = useIsMobile();
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
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
  }, []);

  const closeMenu = useCallback(() => setOpen(false), []);

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
      // Organization switcher. On mobile it expands inline (MenuRowCollapsible)
      // because the menu sits hard against a screen edge where a fixed-width
      // side flyout can't stay on-screen. On larger screens we keep the Radix
      // sub-menu popup, which has room to anchor and reveals the full
      // scrollable panel without pushing the rest of the menu down.
      const currentOrgName = currentOrg?.name ?? tNav('orgSwitcher.label');
      groups.push([
        isMobile
          ? {
              type: 'custom',
              content: (
                <MenuRowCollapsible
                  icon={Building2}
                  label={tNav('orgSwitcher.label')}
                  badge={currentOrgName}
                >
                  <OrganizationListPanel
                    currentOrganizationId={organizationId}
                    hideHeader
                  />
                </MenuRowCollapsible>
              ),
            }
          : {
              type: 'sub',
              label: tNav('orgSwitcher.label'),
              icon: Building2,
              trailing: <MenuRowBadge>{currentOrgName}</MenuRowBadge>,
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

      // Team filter — mirrors the org switcher: inline collapsible on mobile,
      // Radix sub-menu popup on larger screens. Always shown once the teams
      // query has resolved, even with zero teams: the panel then surfaces an
      // empty state plus a "Create team" action, so the section never silently
      // disappears for orgs that haven't set up teams yet.
      if (teams) {
        const selectedTeamName = selectedTeamId
          ? (teams.find((team) => team.id === selectedTeamId)?.name ??
            tNav('teamFilter.allTeams'))
          : tNav('teamFilter.allTeams');

        const selectTeam = (teamId: string | null) => {
          setSelectedTeamId?.(teamId);
          if (organizationId) {
            void navigate({
              to: '/dashboard/$id/chat',
              params: { id: organizationId },
            });
          }
        };

        groups.push([
          isMobile
            ? {
                type: 'custom',
                content: (
                  <MenuRowCollapsible
                    icon={UsersRound}
                    label={tNav('teamFilter.label')}
                    badge={selectedTeamName}
                  >
                    <TeamListPanel
                      organizationId={organizationId}
                      teams={teams}
                      selectedTeamId={selectedTeamId}
                      onSelectTeam={selectTeam}
                      hideHeader
                    />
                  </MenuRowCollapsible>
                ),
              }
            : {
                type: 'sub',
                label: tNav('teamFilter.label'),
                icon: UsersRound,
                trailing: <MenuRowBadge>{selectedTeamName}</MenuRowBadge>,
                items: [
                  [
                    {
                      type: 'custom',
                      content: (
                        <TeamListPanel
                          organizationId={organizationId}
                          teams={teams}
                          selectedTeamId={selectedTeamId}
                          onSelectTeam={selectTeam}
                          onManageTeams={closeMenu}
                        />
                      ),
                    },
                  ],
                ],
                className: 'py-2.5',
                contentClassName: 'w-72',
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
      isMobile
        ? {
            type: 'custom',
            content: (
              <MenuRowCollapsible
                icon={Languages}
                label={t('userButton.language')}
              >
                <div role="radiogroup" aria-label={t('userButton.language')}>
                  {(['en', 'de', 'fr'] as const).map((value) => {
                    const checked = currentLocaleValue === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={checked}
                        onClick={(e) => {
                          e.stopPropagation();
                          setLocale(value);
                        }}
                        className="focus:bg-accent hover:bg-accent relative flex w-full cursor-default items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-left text-sm outline-none"
                      >
                        {renderLanguageOption(value)}
                        {checked && (
                          <Check className="absolute right-2 size-3.5" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </MenuRowCollapsible>
            ),
          }
        : {
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
        label: t('userButton.documentation'),
        icon: BookOpen,
        href: 'https://tale.dev/docs',
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
    isMobile,
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
    closeMenu,
  ]);

  const isSidebarVariant = sidebarExpanded !== undefined;

  const triggerContent = (
    <button
      ref={menuTriggerRef}
      type="button"
      aria-label={t('userButton.manageAccount')}
      className={cn(
        'hover:bg-muted relative flex cursor-pointer items-center transition-colors',
        isSidebarVariant
          ? cn(
              'h-9 gap-2.5 overflow-hidden rounded-md pr-2 pl-2',
              ROW_TRANSITION_CLASS,
            )
          : 'justify-center rounded-md p-2',
      )}
      style={isSidebarVariant ? rowWidthStyle(sidebarExpanded) : undefined}
    >
      <div className="relative shrink-0">
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
      {isSidebarVariant && (
        <span
          aria-hidden
          className={cn(
            'text-muted-foreground min-w-0 flex-1 truncate text-left text-[13px]',
            labelFadeClass(sidebarExpanded ?? false),
          )}
        >
          {displayName}
        </span>
      )}
    </button>
  );

  const signOutConfirmDialog = (
    <ConfirmDialog
      open={signOutDialogOpen}
      onOpenChange={setSignOutDialogOpen}
      title={t('userButton.logOutConfirm.title')}
      description={t('userButton.logOutConfirm.description')}
      confirmText={t('userButton.logOutConfirm.confirm')}
      onConfirm={handleSignOut}
      restoreFocusRef={menuTriggerRef}
    />
  );

  const overlays = (
    <>
      {signOutConfirmDialog}
      <IosInstallSheet open={iosSheetOpen} onOpenChange={setIosSheetOpen} />
    </>
  );

  const contentClassName = 'w-64';

  // The expanded sidebar row shows the display name inline, so the hover
  // tooltip only exists for the icon-only/collapsed tile.
  if (isSidebarVariant && sidebarExpanded) {
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
            // On the rail the menu opens beside the tile: 16px offset = the
            // tile's 8px inset to the rail edge + an 8px gap to the nav
            // (matches the notification popover).
            align={isSidebarVariant ? (align ?? 'end') : align}
            side={isSidebarVariant ? 'right' : undefined}
            sideOffset={isSidebarVariant ? 16 : undefined}
            // The rail's own 8px inset: any more and Radix shifts the menu up,
            // off the trigger's bottom edge the bell panel aligns with.
            collisionPadding={isSidebarVariant ? 8 : undefined}
            open={open}
            onOpenChange={handleOpenChange}
            contentClassName={contentClassName}
          />
          <TooltipPrimitive.Content
            side="right"
            sideOffset={4}
            className="bg-foreground text-background animate-in fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 z-[60] overflow-hidden rounded-lg border p-2 py-1 text-xs shadow-md"
          >
            {t('userButton.manageAccount')}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Root>
      </TooltipPrimitive.Provider>
      {overlays}
    </>
  );
}
