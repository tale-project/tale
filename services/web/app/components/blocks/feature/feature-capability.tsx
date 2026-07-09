import {
  MarketingExternalLink,
  MarketingPanel,
  MarketingStack,
  PageSection,
  Reveal,
  SectionHeading,
} from '@/app/components/marketing';

export interface FeatureCapabilityItem {
  title: string;
  body: string;
  /** Optional docs deep-link shown as "Read more". */
  docsHref?: string;
  docsLabel?: string;
}

interface FeatureCapabilityProps {
  heading: string;
  description?: string;
  items: readonly FeatureCapabilityItem[];
}

/**
 * Capability claims as a numbered divider panel — no per-cell card chrome.
 * An odd last item spans both columns so the grid doesn't leave a hole.
 */
export function FeatureCapability({
  heading,
  description,
  items,
}: FeatureCapabilityProps) {
  return (
    <PageSection pad="lg" border="b">
      <MarketingStack max="xl" gap="xl" align="stretch">
        <SectionHeading
          size="section"
          title={heading}
          description={description}
          align="start"
        />
        <MarketingPanel>
          <ul role="list" className="bg-border-base grid gap-px sm:grid-cols-2">
            {items.map((item, index) => {
              const isLastOdd =
                items.length % 2 === 1 && index === items.length - 1;
              return (
                <li
                  key={item.title}
                  className={
                    isLastOdd
                      ? 'bg-surface-site-raised sm:col-span-2'
                      : 'bg-surface-site-raised'
                  }
                >
                  <Reveal delay={index * 0.04}>
                    <article
                      className={
                        isLastOdd
                          ? 'flex h-full max-w-2xl flex-col gap-3 px-5 py-7 md:px-8 md:py-9'
                          : 'flex h-full flex-col gap-3 px-5 py-7 md:px-8 md:py-9'
                      }
                    >
                      <p className="text-fg-subtle text-[12px] font-medium tracking-[0.1em] uppercase">
                        {String(index + 1).padStart(2, '0')}
                      </p>
                      <h3
                        className="text-fg-base text-xl font-normal tracking-[-0.03em] md:text-[22px]"
                        style={{ lineHeight: 1.2 }}
                      >
                        {item.title}
                      </h3>
                      <p
                        className="text-fg-muted flex-1 text-[15px] md:text-base"
                        style={{
                          letterSpacing: '-0.015em',
                          lineHeight: 1.55,
                        }}
                      >
                        {item.body}
                      </p>
                      {item.docsHref && item.docsLabel ? (
                        <MarketingExternalLink
                          href={item.docsHref}
                          tone="inline"
                          className="mt-1 w-fit text-sm"
                        >
                          {item.docsLabel}
                        </MarketingExternalLink>
                      ) : null}
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
