'use client';

import { useParams } from 'next/navigation';
import { useT } from '@/lib/i18n';
import {
  TabNavigation,
  type TabNavigationItem,
} from '@/components/ui/tab-navigation';

interface SettingsNavigationProps {
  userRole?: string | null;
  canChangePassword?: boolean;
}

type SettingsLabelKey = 'organization' | 'integrations' | 'account';

export function SettingsNavigation({
  userRole,
  canChangePassword = true,
}: SettingsNavigationProps) {
  const { t } = useT('navigation');
  const { t: tCommon } = useT('common');
  const params = useParams();
  const organizationId = params.id as string;

  const allItems: (TabNavigationItem & { labelKey: SettingsLabelKey })[] = [
    {
      labelKey: 'organization',
      label: t('organization'),
      href: `/dashboard/${organizationId}/settings/organization`,
      roles: ['admin'],
    },
    {
      labelKey: 'integrations',
      label: t('integrations'),
      href: `/dashboard/${organizationId}/settings/integrations`,
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
      className="top-0 py-3 h-12"
      ariaLabel={tCommon('aria.settingsNavigation')}
    />
  );
}
