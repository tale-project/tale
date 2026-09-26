'use client';

import { SectionNavPanel, SectionNavRow } from '@tale/ui/section-nav';
import { useLocation } from '@tanstack/react-router';
import {
  Contact,
  FileText,
  Globe,
  NotebookText,
  Package,
  type LucideIcon,
} from 'lucide-react';

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

interface KnowledgePage {
  readonly labelKey: KnowledgeLabelKey;
  readonly path: string;
  readonly icon: LucideIcon;
}

/** Knowledge's pages, in reading order — one list for the desktop panel, the
 * phone's tab strip and the page header's title. */
const KNOWLEDGE_PAGES: readonly KnowledgePage[] = [
  { labelKey: 'documents', path: 'documents', icon: FileText },
  {
    labelKey: 'knowledgeEntries',
    path: 'knowledge-entries',
    icon: NotebookText,
  },
  { labelKey: 'websites', path: 'websites', icon: Globe },
  { labelKey: 'products', path: 'products', icon: Package },
  { labelKey: 'contacts', path: 'contacts', icon: Contact },
];

function isWithin(href: string, pathname: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The open Knowledge page's name, for the page header beside the panel. */
export function useKnowledgePageTitle(organizationId: string) {
  const { t } = useT('knowledge');
  const { pathname } = useLocation();
  const page = KNOWLEDGE_PAGES.find((entry) =>
    isWithin(`/dashboard/${organizationId}/${entry.path}`, pathname),
  );
  return page !== undefined ? t(page.labelKey) : t('title');
}

/**
 * Knowledge's panel — the same frame as Home's and Settings': the section's
 * name, then one icon row per page with the gliding highlight. Desktop only;
 * a phone switches pages with {@link KnowledgeNavigation}'s tab strip.
 */
export function KnowledgePanel({ organizationId }: KnowledgeNavigationProps) {
  const { t } = useT('knowledge');
  const { t: tCommon } = useT('common');
  const { pathname } = useLocation();
  const base = `/dashboard/${organizationId}`;
  const active = KNOWLEDGE_PAGES.find((entry) =>
    isWithin(`${base}/${entry.path}`, pathname),
  );
  return (
    <SectionNavPanel
      title={t('title')}
      ariaLabel={tCommon('aria.knowledgeNavigation')}
      activeKey={active !== undefined ? `${base}/${active.path}` : null}
    >
      <ul className="flex flex-col gap-0.5">
        {KNOWLEDGE_PAGES.map((entry) => {
          const href = `${base}/${entry.path}`;
          return (
            <SectionNavRow
              key={entry.path}
              href={href}
              label={t(entry.labelKey)}
              icon={entry.icon}
              active={active === entry}
            />
          );
        })}
      </ul>
    </SectionNavPanel>
  );
}

/** The phone's way between Knowledge's pages: the same pages as a tab strip
 * under the header, where a desktop shows the panel. */
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
