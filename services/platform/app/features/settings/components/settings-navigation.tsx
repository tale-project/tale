'use client';

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
  | 'account';

export function SettingsNavigation({
  organizationId,
  showAccountTab = true,
}: SettingsNavigationProps) {
  const { t } = useT('navigation');
  const { t: tCommon } = useT('common');

  const allItems: (TabNavigationItem & { labelKey: SettingsLabelKey })[] = [
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
    },
    {
      labelKey: 'logs',
      label: t('logs'),
      href: `/dashboard/${organizationId}/settings/logs`,
      can: ['read', 'orgSettings'],
    },
    {
      labelKey: 'account',
      label: t('account'),
      href: `/dashboard/${organizationId}/settings/account`,
    },
  ];

  const navigationItems = allItems.filter(
    (item) => showAccountTab || item.labelKey !== 'account',
  );

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
