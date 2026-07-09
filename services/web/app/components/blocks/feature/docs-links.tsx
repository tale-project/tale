import { ArrowUpRight } from 'lucide-react';

import {
  MarketingExternalLink,
  MarketingPanel,
  MarketingStack,
  PageSection,
  SectionHeading,
} from '@/app/components/marketing';
import { useT } from '@/lib/i18n/client';

export interface DocsLinkItem {
  label: string;
  href: string;
}

interface DocsLinksProps {
  heading?: string;
  links: readonly DocsLinkItem[];
}

/** Deep-links into docs — how-to intent stays with docs, not marketing. */
export function DocsLinks({ heading, links }: DocsLinksProps) {
  const { t } = useT('featureShared');
  if (links.length === 0) return null;

  return (
    <PageSection pad="lg" border="b">
      <MarketingStack max="md" gap="lg" align="stretch">
        <SectionHeading
          size="subsection"
          as="h2"
          title={heading ?? t('docsHeading')}
          align="start"
        />
        <MarketingPanel>
          <ul role="list" className="divide-border-base divide-y">
            {links.map((link) => (
              <li key={link.href}>
                <MarketingExternalLink
                  href={link.href}
                  tone="plain"
                  showIcon={false}
                  className="text-fg-base hover:bg-surface-site-inset/70 group flex items-center gap-3 px-5 py-4 text-[15px] font-normal tracking-tight transition-colors md:px-6 md:py-5 md:text-base"
                >
                  <span className="min-w-0 flex-1">{link.label}</span>
                  <ArrowUpRight
                    aria-hidden
                    className="text-fg-muted group-hover:text-fg-base size-4 shrink-0 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                  />
                </MarketingExternalLink>
              </li>
            ))}
          </ul>
        </MarketingPanel>
      </MarketingStack>
    </PageSection>
  );
}
