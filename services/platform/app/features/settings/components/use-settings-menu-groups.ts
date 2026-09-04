import {
  Blocks,
  Box,
  Building2,
  Bell,
  ChartColumn,
  Database,
  IdCard,
  KeyRound,
  Palette,
  Plug,
  Shield,
  SlidersHorizontal,
  Sparkles,
  User,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { useMemo } from 'react';

import type {
  SettingsSectionListGroup,
  SettingsSectionListItem,
} from '@/app/features/settings/components/settings-section-list';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import type { AppAction, AppSubject } from '@/lib/permissions/ability';

export type SettingsMenuScope = 'personal' | 'workspace';

interface SectionConfig {
  key: string;
  icon: LucideIcon;
  path: string;
  can?: [AppAction, AppSubject];
}

/**
 * Shared section catalog for the mobile settings overviews. The personal
 * scope shows only `you`-group entries (account, personalization); the
 * workspace scope shows the organization + advanced groups. Permission
 * gates filter each list against the current member's ability before render.
 */
export function useSettingsMenuGroups(
  organizationId: string,
  scope: SettingsMenuScope,
): SettingsSectionListGroup[] {
  const ability = useAbility();
  const { t: tNav } = useT('navigation');
  const { t: tSettings } = useT('settings');

  return useMemo<SettingsSectionListGroup[]>(() => {
    const personalConfig: SectionConfig[] = [
      { key: 'account', icon: User, path: 'account' },
      {
        key: 'personalization',
        icon: SlidersHorizontal,
        path: 'personalization',
      },
      {
        key: 'notifications',
        icon: Bell,
        path: 'notifications',
      },
    ];

    // Order mirrors the desktop rail: who we are (organization, teams,
    // members), then what the workspace runs on (providers, connectors),
    // then the rest.
    const organizationConfig: SectionConfig[] = [
      {
        key: 'organization',
        icon: Building2,
        path: 'organization',
        can: ['read', 'orgSettings'],
      },
      {
        key: 'teams',
        icon: Users,
        path: 'teams',
        can: ['read', 'orgSettings'],
      },
      {
        key: 'members',
        icon: UsersRound,
        path: 'members',
        can: ['read', 'orgSettings'],
      },
      {
        key: 'providers',
        icon: Sparkles,
        path: 'providers',
        can: ['read', 'developerSettings'],
      },
      {
        key: 'connectors',
        icon: Plug,
        path: 'connectors',
        can: ['read', 'developerSettings'],
      },
      // No `can`: any member may read the skills they are allowed to see.
      { key: 'skills', icon: Blocks, path: 'skills' },
      {
        key: 'branding',
        icon: Palette,
        path: 'branding',
        can: ['read', 'orgSettings'],
      },
      {
        key: 'sandboxes',
        icon: Box,
        path: 'sandboxes',
        can: ['read', 'developerSettings'],
      },
      {
        key: 'governance',
        icon: Shield,
        path: 'governance',
        can: ['read', 'orgSettings'],
      },
      {
        key: 'metrics',
        icon: ChartColumn,
        path: 'metrics',
        can: ['read', 'orgSettings'],
      },
    ];

    const advancedConfig: SectionConfig[] = [
      {
        key: 'api',
        icon: KeyRound,
        path: 'api',
        can: ['read', 'developerSettings'],
      },
      {
        key: 'enterpriseSso',
        icon: IdCard,
        path: 'enterprise-sso',
        can: ['read', 'orgSettings'],
      },
      {
        key: 'dataResidency',
        icon: Database,
        path: 'data-residency',
        can: ['read', 'orgSettings'],
      },
    ];

    const toItem = (cfg: SectionConfig): SettingsSectionListItem => ({
      key: cfg.key,
      label: tNav(cfg.key),
      description: tSettings(`menu.${cfg.key}.description`),
      icon: cfg.icon,
      href: `/dashboard/${organizationId}/settings/${cfg.path}`,
    });

    const filter = (cfgs: SectionConfig[]) =>
      cfgs.filter((c) => !c.can || ability.can(c.can[0], c.can[1])).map(toItem);

    const youGroup: SettingsSectionListGroup = {
      key: 'you',
      label: tSettings('menu.groups.you'),
      items: filter(personalConfig),
    };

    // The combined Settings entry routes mobile users to the workspace
    // overview, so it leads with the personal `you` group too — otherwise
    // Account/Preferences would be unreachable on mobile.
    const groups: SettingsSectionListGroup[] =
      scope === 'personal'
        ? [youGroup]
        : [
            youGroup,
            {
              key: 'organization',
              label: tSettings('menu.groups.organization'),
              items: filter(organizationConfig),
            },
            {
              key: 'advanced',
              label: tSettings('menu.groups.advanced'),
              items: filter(advancedConfig),
            },
          ];

    return groups.filter((group) => group.items.length > 0);
  }, [ability, organizationId, scope, tNav, tSettings]);
}
