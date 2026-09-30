'use client';

import {
  TabNavigation,
  type TabNavigationItem,
} from '@/app/components/navigation/tab-navigation';
import { useT } from '@/lib/i18n/client';

interface KnowledgeNavigationProps {
  organizationId: string;
}

type KnowledgeLabelKey =
  | 'documents'
  | 'knowledgeEntries'
  | 'websites'
  | 'products'
  | 'contacts';

export interface KnowledgePage {
  readonly labelKey: KnowledgeLabelKey;
  readonly path: string;
}

/** Knowledge's pages, in reading order. Exported so the rail's remembered-tab
 *  resolution (`use-navigation-items.ts`) and its persistence
 *  (`lib/knowledge-tab-memory.ts`) share this one list instead of each
 *  duplicating the 5-tab enum. */
export const KNOWLEDGE_PAGES: readonly KnowledgePage[] = [
  { labelKey: 'documents', path: 'documents' },
  { labelKey: 'knowledgeEntries', path: 'knowledge-entries' },
  { labelKey: 'websites', path: 'websites' },
  { labelKey: 'products', path: 'products' },
  { labelKey: 'contacts', path: 'contacts' },
];

/**
 * Knowledge's pages as the tab strip under the section's title row, on every
 * width — the way a project's pages sit under its name.
 */
export function KnowledgeNavigation({
  organizationId,
}: KnowledgeNavigationProps) {
  const { t } = useT('knowledge');
  const { t: tCommon } = useT('common');

  const navigationItems: TabNavigationItem[] = KNOWLEDGE_PAGES.map((entry) => ({
    label: t(entry.labelKey),
    href: `/dashboard/${organizationId}/${entry.path}`,
  }));

  return (
    <TabNavigation
      items={navigationItems}
      standalone={false}
      ariaLabel={tCommon('aria.knowledgeNavigation')}
    />
  );
}
