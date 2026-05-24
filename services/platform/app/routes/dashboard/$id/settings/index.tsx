import { convexQuery } from '@convex-dev/react-query';
import { useIsMobile } from '@tale/ui/use-is-mobile';
import {
  createFileRoute,
  useLoaderData,
  useNavigate,
} from '@tanstack/react-router';
import {
  Building2,
  KeyRound,
  Palette,
  Plug,
  Shield,
  SlidersHorizontal,
  Sparkles,
  User,
  Users,
} from 'lucide-react';
import { useEffect, useMemo } from 'react';

import { SettingsSectionList } from '@/app/features/settings/components/settings-section-list';
import type {
  SettingsSectionListGroup,
  SettingsSectionListItem,
} from '@/app/features/settings/components/settings-section-list';
import { useAbility } from '@/app/hooks/use-ability';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import type { AppAction, AppSubject } from '@/lib/permissions/ability';
import { getDefaultSettingsRoute } from '@/lib/permissions/get-default-settings-route';

export const Route = createFileRoute('/dashboard/$id/settings/')({
  loader: async ({ context, params }) => {
    const memberContext = (await context.queryClient
      .ensureQueryData(
        convexQuery(api.members.queries.getCurrentMemberContext, {
          organizationId: params.id,
        }),
      )
      .catch(() => null)) as { role?: string } | null;

    return { role: memberContext?.role ?? null };
  },
  component: SettingsIndex,
});

interface SectionConfig {
  key: string;
  icon: SettingsSectionListItem['icon'];
  href: string;
  can?: [AppAction, AppSubject];
}

function SettingsIndex() {
  const { id: organizationId } = Route.useParams();
  const { role } = useLoaderData({ from: Route.id });
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const ability = useAbility();
  const { t: tNav } = useT('navigation');
  const { t: tSettings } = useT('settings');

  // Desktop: settings has no "overview" page — bounce to the default
  // permission-aware page so the user lands on something useful.
  useEffect(() => {
    if (!isMobile) {
      void navigate({
        to: getDefaultSettingsRoute(role),
        params: { id: organizationId },
        replace: true,
      });
    }
  }, [isMobile, navigate, organizationId, role]);

  const groups = useMemo<SettingsSectionListGroup[]>(() => {
    const youConfig: SectionConfig[] = [
      {
        key: 'account',
        icon: User,
        href: `/dashboard/${organizationId}/settings/account`,
      },
      {
        key: 'personalization',
        icon: SlidersHorizontal,
        href: `/dashboard/${organizationId}/settings/personalization`,
      },
    ];

    const workspaceConfig: SectionConfig[] = [
      {
        key: 'organization',
        icon: Building2,
        href: `/dashboard/${organizationId}/settings/organization`,
        can: ['read', 'orgSettings'],
      },
      {
        key: 'people',
        icon: Users,
        href: `/dashboard/${organizationId}/settings/people`,
        can: ['read', 'orgSettings'],
      },
      {
        key: 'branding',
        icon: Palette,
        href: `/dashboard/${organizationId}/settings/branding`,
        can: ['read', 'orgSettings'],
      },
      {
        key: 'integrations',
        icon: Plug,
        href: `/dashboard/${organizationId}/settings/integrations`,
        can: ['read', 'developerSettings'],
      },
      {
        key: 'providers',
        icon: Sparkles,
        href: `/dashboard/${organizationId}/settings/providers`,
        can: ['read', 'developerSettings'],
      },
      {
        key: 'apiKeys',
        icon: KeyRound,
        href: `/dashboard/${organizationId}/settings/api-keys`,
        can: ['read', 'developerSettings'],
      },
    ];

    const governanceConfig: SectionConfig[] = [
      {
        key: 'governance',
        icon: Shield,
        href: `/dashboard/${organizationId}/settings/governance`,
        can: ['read', 'orgSettings'],
      },
    ];

    const toItem = (cfg: SectionConfig): SettingsSectionListItem => ({
      key: cfg.key,
      label: tNav(cfg.key),
      description: tSettings(`menu.${cfg.key}.description`),
      icon: cfg.icon,
      href: cfg.href,
    });

    const filter = (cfgs: SectionConfig[]) =>
      cfgs.filter((c) => !c.can || ability.can(c.can[0], c.can[1])).map(toItem);

    return [
      {
        key: 'you',
        label: tSettings('menu.groups.you'),
        items: filter(youConfig),
      },
      {
        key: 'workspace',
        label: tSettings('menu.groups.workspace'),
        items: filter(workspaceConfig),
      },
      {
        key: 'governance',
        label: tSettings('menu.groups.governance'),
        items: filter(governanceConfig),
      },
    ].filter((group) => group.items.length > 0);
  }, [ability, organizationId, tNav, tSettings]);

  if (!isMobile) return null;

  return (
    <SettingsSectionList groups={groups} ariaLabel={tNav('userSettings')} />
  );
}
