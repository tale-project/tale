'use client';

import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/ui/navigation/tab-navigation';
import { useT } from '@/lib/i18n/client';

interface KnowledgeNavigationProps {
  organizationId: string;
}

type KnowledgeLabelKey =
  | 'documents'
  | 'knowledgeEntries'
  | 'websites'
  | 'products'
  | 'customers'
  | 'vendors';

export function KnowledgeNavigation({
  organizationId,
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
      labelKey: 'knowledgeEntries',
      label: t('knowledgeEntries'),
      href: `/dashboard/${organizationId}/knowledge-entries`,
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
  ];

  return (
    <TabNavigation
      items={navigationItems}
      standalone={false}
      ariaLabel={tCommon('aria.knowledgeNavigation')}
    />
  );
}
