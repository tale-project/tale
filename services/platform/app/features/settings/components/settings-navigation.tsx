'use client';

import { useLocation } from '@tanstack/react-router';

import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/ui/navigation/tab-navigation';
import { useT } from '@/lib/i18n/client';

interface SettingsNavigationProps {
  organizationId: string;
  showAccountTab?: boolean;
}

type SettingsLabelKey =
  | 'organization'
  | 'teams'
  | 'integrations'
  | 'mcpServers'
  | 'providers'
  | 'apiKeys'
  | 'branding'
  | 'governance'
  | 'logs'
  | 'personalization'
  | 'account';

// User-scoped tabs — surfaced under "Settings" (the profile panel entry).
const USER_KEYS: ReadonlySet<SettingsLabelKey> = new Set([
  'account',
  'personalization',
]);

/**
 * Detect whether the current settings path belongs to the user scope
 * (account / personalization) or the organization scope (everything else).
 */
function isUserScope(pathname: string): boolean {
  return (
    pathname.includes('/settings/account') ||
    pathname.includes('/settings/personalization')
  );
}

export function SettingsNavigation({
  organizationId,
  showAccountTab = true,
}: SettingsNavigationProps) {
  const { t } = useT('navigation');
  const { t: tCommon } = useT('common');
  const location = useLocation();
  const userScope = isUserScope(location.pathname);

  // Account first within the user scope — when the user lands on user
  // settings the most-commonly-edited section ("Account") sits at the start.
  const allItems: (TabNavigationItem & { labelKey: SettingsLabelKey })[] = [
    {
      labelKey: 'account',
      label: t('account'),
      href: `/dashboard/${organizationId}/settings/account`,
    },
    {
      labelKey: 'personalization',
      label: t('personalization'),
      href: `/dashboard/${organizationId}/settings/personalization`,
    },
    {
      labelKey: 'organization',
      label: t('organization'),
      href: `/dashboard/${organizationId}/settings/organization`,
      can: ['read', 'orgSettings'],
    },
    {
      labelKey: 'teams',
      label: t('teams'),
      href: `/dashboard/${organizationId}/settings/teams`,
      can: ['read', 'orgSettings'],
    },
    {
      labelKey: 'integrations',
      label: t('integrations'),
      href: `/dashboard/${organizationId}/settings/integrations`,
      can: ['read', 'developerSettings'],
    },
    {
      labelKey: 'mcpServers',
      label: t('mcpServers'),
      href: `/dashboard/${organizationId}/settings/mcp-servers`,
      can: ['read', 'developerSettings'],
    },
    {
      labelKey: 'providers',
      label: t('providers'),
      href: `/dashboard/${organizationId}/settings/providers`,
      can: ['read', 'developerSettings'],
      matchMode: 'startsWith',
    },
    {
      labelKey: 'apiKeys',
      label: t('apiKeys'),
      href: `/dashboard/${organizationId}/settings/api-keys`,
      can: ['read', 'developerSettings'],
    },
    {
      labelKey: 'branding',
      label: t('branding'),
      href: `/dashboard/${organizationId}/settings/branding`,
      can: ['read', 'orgSettings'],
    },
    {
      labelKey: 'governance',
      label: t('governance'),
      href: `/dashboard/${organizationId}/settings/governance`,
      can: ['read', 'orgSettings'],
      matchMode: 'startsWith',
    },
    {
      labelKey: 'logs',
      label: t('logs'),
      href: `/dashboard/${organizationId}/settings/logs`,
      can: ['read', 'orgSettings'],
    },
  ];

  // Truly split the two settings surfaces: user-scoped pages only see the
  // user tabs, organization-scoped pages only see the org tabs. Each page
  // therefore has its own self-contained tab strip.
  const navigationItems = allItems.filter((item) => {
    if (!showAccountTab && item.labelKey === 'account') return false;
    const inUserScope = USER_KEYS.has(item.labelKey);
    return userScope ? inUserScope : !inUserScope;
  });

  return (
    <TabNavigation
      items={navigationItems}
      matchMode="exact"
      standalone={false}
      className="h-12 py-3"
      ariaLabel={tCommon('aria.settingsNavigation')}
    />
  );
}
