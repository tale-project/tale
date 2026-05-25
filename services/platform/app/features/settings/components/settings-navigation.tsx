'use client';

import { useLocation } from '@tanstack/react-router';

import { EditorActions, useActiveEditor } from '@/app/components/ui/editor';
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
  | 'people'
  | 'integrations'
  | 'providers'
  | 'apiKeys'
  | 'branding'
  | 'governance'
  | 'personalization'
  | 'account';

const USER_KEYS: ReadonlySet<SettingsLabelKey> = new Set([
  'account',
  'personalization',
]);

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
      labelKey: 'people',
      label: t('people'),
      href: `/dashboard/${organizationId}/settings/people`,
      can: ['read', 'orgSettings'],
      matchMode: 'startsWith',
    },
    {
      labelKey: 'branding',
      label: t('branding'),
      href: `/dashboard/${organizationId}/settings/branding`,
      can: ['read', 'orgSettings'],
    },
    {
      labelKey: 'integrations',
      label: t('integrations'),
      href: `/dashboard/${organizationId}/settings/integrations`,
      can: ['read', 'developerSettings'],
      matchMode: 'startsWith',
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
      labelKey: 'governance',
      label: t('governance'),
      href: `/dashboard/${organizationId}/settings/governance`,
      can: ['read', 'orgSettings'],
      matchMode: 'startsWith',
    },
  ];

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
    >
      <SettingsEditorActionsSlot />
    </TabNavigation>
  );
}

/**
 * Reads the active child controller (settings sub-page form) and renders
 * the unified Save/Discard cluster in the settings tab strip. Sub-pages
 * without forms (people, integrations list, audit logs) clear the active
 * editor and the cluster doesn't render.
 */
function SettingsEditorActionsSlot() {
  const controller = useActiveEditor();
  if (!controller) return null;
  return <EditorActions controller={controller} entityKind="settings" />;
}
