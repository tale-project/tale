'use client';

import { useParams } from 'next/navigation';
import { useT } from '@/lib/i18n';
import {
  TabNavigation,
  type TabNavigationItem,
} from '@/components/ui/navigation/tab-navigation';

interface KnowledgeNavigationProps {
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
  userRole,
}: KnowledgeNavigationProps) {
  const { t } = useT('knowledge');
  const params = useParams();
  const businessId = params.id as string;

  const navigationItems: (TabNavigationItem & {
    labelKey: KnowledgeLabelKey;
  })[] = [
    {
      labelKey: 'documents',
      label: t('documents'),
      href: `/dashboard/${businessId}/documents`,
    },
    {
      labelKey: 'websites',
      label: t('websites'),
      href: `/dashboard/${businessId}/websites`,
    },
    {
      labelKey: 'products',
      label: t('products'),
      href: `/dashboard/${businessId}/products`,
    },
    {
      labelKey: 'customers',
      label: t('customers'),
      href: `/dashboard/${businessId}/customers`,
    },
    {
      labelKey: 'vendors',
      label: t('vendors'),
      href: `/dashboard/${businessId}/vendors`,
    },
    {
      labelKey: 'toneOfVoice',
      label: t('toneOfVoice'),
      href: `/dashboard/${businessId}/tone-of-voice`,
    },
  ];

  return (
    <TabNavigation
      items={navigationItems}
      userRole={userRole}
      standalone={false}
      className="py-2"
    />
  );
}
