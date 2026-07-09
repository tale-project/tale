import type { LucideIcon } from 'lucide-react';

import {
  MarketingPanel,
  MarketingStack,
  PageSection,
  Reveal,
  SectionHeading,
} from '@/app/components/marketing';

export interface FeatureHighlightItem {
  title: string;
  body: string;
  icon?: LucideIcon;
}

interface FeatureHighlightsProps {
  heading: string;
  description?: string;
  items: readonly FeatureHighlightItem[];
}

/**
 * Mid-page narrative band — three concrete moments as framed divider columns.
 */
export function FeatureHighlights({
  heading,
  description,
  items,
}: FeatureHighlightsProps) {
  if (items.length === 0) return null;

  return (
    <PageSection surface="site" pad="xl" border="b">
      <MarketingStack max="xl" gap="xl" align="stretch">
        <SectionHeading
          size="section"
          title={heading}
          description={description}
          align="start"
        />
        <MarketingPanel>
          <ul role="list" className="bg-border-base grid gap-px md:grid-cols-3">
            {items.map((item, index) => {
              const Icon = item.icon;
              return (
                <li key={item.title} className="bg-surface-site-raised">
                  <Reveal delay={index * 0.06}>
                    <article className="flex h-full flex-col gap-3 px-5 py-8 md:px-8 md:py-10">
                      {Icon ? (
                        <span className="border-border-base bg-surface-site-deep text-fg-base shadow-site-inset mb-2 flex size-10 items-center justify-center rounded-xl border">
                          <Icon
                            aria-hidden
                            className="size-4.5"
                            strokeWidth={1.75}
                          />
                        </span>
                      ) : (
                        <p className="text-fg-subtle text-[12px] font-medium tracking-[0.1em] uppercase">
                          {String(index + 1).padStart(2, '0')}
                        </p>
                      )}
                      <h3
                        className="text-fg-base text-xl font-normal tracking-[-0.03em]"
                        style={{ lineHeight: 1.2 }}
                      >
                        {item.title}
                      </h3>
                      <p
                        className="text-fg-muted text-base"
                        style={{ letterSpacing: '-0.015em', lineHeight: 1.55 }}
                      >
                        {item.body}
                      </p>
                    </article>
                  </Reveal>
                </li>
              );
            })}
          </ul>
        </MarketingPanel>
      </MarketingStack>
    </PageSection>
  );
}
