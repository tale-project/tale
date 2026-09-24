import { cn } from '@tale/ui/cn';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  MarketingCard,
  MarketingPanel,
  MarketingStack,
  PageSection,
  SectionHeading,
} from '../marketing';

export interface RelatedPageItem {
  /** Stable React key. */
  id: string;
  /** Site path — rendered through the host's link component. */
  to: string;
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
}

interface RelatedPagesProps {
  heading: string;
  /** Already-resolved pages, in display order. */
  items: readonly RelatedPageItem[];
}

function relatedGridClass(count: number): string {
  if (count <= 1) return 'grid-cols-1';
  if (count === 2 || count === 4) return 'grid-cols-1 sm:grid-cols-2';
  return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
}

/** Related-pages panel — a divider grid of linked `MarketingCard` cells. */
export function RelatedPages({ heading, items }: RelatedPagesProps) {
  if (items.length === 0) return null;

  return (
    <PageSection pad="xl" border="b">
      <MarketingStack max="xl" gap="xl" align="stretch">
        <SectionHeading size="section" as="h2" title={heading} align="start" />
        <MarketingPanel>
          <ul
            role="list"
            className={cn(
              'bg-border-base grid gap-px',
              relatedGridClass(items.length),
            )}
          >
            {items.map((item) => (
              <li key={item.id} className="bg-surface-site-raised">
                <MarketingCard
                  to={item.to}
                  title={item.title}
                  description={item.description}
                  icon={item.icon}
                  className="h-full"
                  reveal={false}
                />
              </li>
            ))}
          </ul>
        </MarketingPanel>
      </MarketingStack>
    </PageSection>
  );
}
