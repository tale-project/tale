import {
  MarketingPanel,
  MarketingStack,
  PageSection,
  Reveal,
  SectionHeading,
} from '@/app/components/marketing';

interface FeatureStep {
  title: string;
  body: string;
}

interface FeatureStepsProps {
  heading: string;
  description?: string;
  steps: readonly FeatureStep[];
}

/** Numbered how-it-works strip — framed divider columns, no card chrome. */
export function FeatureSteps({
  heading,
  description,
  steps,
}: FeatureStepsProps) {
  return (
    <PageSection pad="lg" border="b">
      <MarketingStack max="xl" gap="xl" align="stretch">
        <SectionHeading
          size="section"
          title={heading}
          description={description}
        />
        <MarketingPanel>
          <ol className="bg-border-base grid gap-px md:grid-cols-3">
            {steps.map((step, index) => (
              <li key={step.title} className="bg-surface-site-raised">
                <Reveal delay={index * 0.05}>
                  <article className="flex h-full flex-col gap-3 px-5 py-8 md:px-8 md:py-10">
                    <p className="text-fg-subtle text-[12px] font-medium tracking-[0.1em] uppercase">
                      {String(index + 1).padStart(2, '0')}
                    </p>
                    <h3
                      className="text-fg-base text-xl font-normal tracking-[-0.03em]"
                      style={{ lineHeight: 1.2 }}
                    >
                      {step.title}
                    </h3>
                    <p
                      className="text-fg-muted text-base"
                      style={{ letterSpacing: '-0.015em', lineHeight: 1.55 }}
                    >
                      {step.body}
                    </p>
                  </article>
                </Reveal>
              </li>
            ))}
          </ol>
        </MarketingPanel>
      </MarketingStack>
    </PageSection>
  );
}
