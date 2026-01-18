'use client';

import { useT } from '@/lib/i18n/client';
import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/ui/navigation/tab-navigation';

interface KnowledgeNavigationProps {
  organizationId: string;
  userRole?: string | null;
}

type KnowledgeLabelKey =
  | 'documents'
  | 'websites'
  | 'products'
  | 'customers'
  | 'vendors'
  | 'toneOfVoice';

export function KnowledgeNavigation({
  organizationId,
  userRole,
}: KnowledgeNavigationProps) {
  const { t } = useT('knowledge');
  const { t: tCommon } = useT('common');

  const navigationItems: (TabNavigationItem & {
    labelKey: KnowledgeLabelKey;
  })[] = [
    {
      labelKey: 'documents',
      label: t('documents'),
      href: `/dashboard/${organizationId}/documents`,
    },
    {
      labelKey: 'websites',
      label: t('websites'),
      href: `/dashboard/${organizationId}/websites`,
    },
    {
      labelKey: 'products',
      label: t('products'),
      href: `/dashboard/${organizationId}/products`,
    },
    {
      labelKey: 'customers',
      label: t('customers'),
      href: `/dashboard/${organizationId}/customers`,
    },
    {
      labelKey: 'vendors',
      label: t('vendors'),
      href: `/dashboard/${organizationId}/vendors`,
    },
    {
      labelKey: 'toneOfVoice',
      label: t('toneOfVoice'),
      href: `/dashboard/${organizationId}/tone-of-voice`,
    },
  ];

  return (
    <TabNavigation
      items={navigationItems}
      userRole={userRole}
      standalone={false}
      className="py-3 h-12"
      ariaLabel={tCommon('aria.knowledgeNavigation')}
    />
  );
}
