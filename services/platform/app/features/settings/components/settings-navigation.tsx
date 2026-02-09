'use client';

import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/ui/navigation/tab-navigation';
import { useT } from '@/lib/i18n/client';

interface SettingsNavigationProps {
  organizationId: string;
  userRole?: string | null;
  canChangePassword?: boolean;
}

type SettingsLabelKey =
  | 'organization'
  | 'teams'
  | 'integrations'
  | 'apiKeys'
  | 'account';

export function SettingsNavigation({
  organizationId,
  userRole,
  canChangePassword = true,
}: SettingsNavigationProps) {
  const { t } = useT('navigation');
  const { t: tCommon } = useT('common');

  const allItems: (TabNavigationItem & { labelKey: SettingsLabelKey })[] = [
    {
      labelKey: 'organization',
      label: t('organization'),
      href: `/dashboard/${organizationId}/settings/organization`,
      roles: ['admin'],
    },
    {
      labelKey: 'teams',
      label: t('teams'),
      href: `/dashboard/${organizationId}/settings/teams`,
      roles: ['admin'],
    },
    {
      labelKey: 'integrations',
      label: t('integrations'),
      href: `/dashboard/${organizationId}/settings/integrations`,
      roles: ['admin', 'developer'],
    },
    {
      labelKey: 'apiKeys',
      label: t('apiKeys'),
      href: `/dashboard/${organizationId}/settings/api-keys`,
      roles: ['admin', 'developer'],
    },
    {
      labelKey: 'account',
      label: t('account'),
      href: `/dashboard/${organizationId}/settings/account`,
    },
  ];

  const navigationItems = allItems.filter(
    (item) => canChangePassword || item.labelKey !== 'account',
  );

  return (
    <TabNavigation
      items={navigationItems}
      userRole={userRole}
      matchMode="exact"
      standalone={false}
      className="h-12 py-3"
      ariaLabel={tCommon('aria.settingsNavigation')}
    />
  );
}
