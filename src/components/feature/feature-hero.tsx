import { cn } from '@tale/ui/cn';
import type { ReactNode } from 'react';

import { DemoStage } from '../demos/demo-stage';
import { PageSection, Reveal, SectionHeading } from '../marketing';

interface FeatureHeroProps {
  eyebrow?: string;
  title: string;
  description: string;
  /** Product illustration, supplied by the host. */
  visual?: ReactNode;
  /** CTA row or search action. Routing and labels belong to the host. */
  actions?: ReactNode;
  /** Supporting facts below the introduction; never fabricated metrics. */
  proof?: ReactNode;
  /** `stacked` preserves the feature-page heading pair and visual below. */
  layout?: 'stacked' | 'split';
  /** Use `plain` when the visual already owns its frame or background. */
  visualTreatment?: 'stage' | 'plain';
}

/** Shared lead for feature pages and distinct public front-page compositions. */
export function FeatureHero({
  eyebrow,
  title,
  description,
  visual,
  actions,
  proof,
  layout = 'stacked',
  visualTreatment = 'stage',
}: FeatureHeroProps) {
  const split = layout === 'split';
  const illustration = visual ? (
    visualTreatment === 'stage' ? (
      <DemoStage variant="section">{visual}</DemoStage>
    ) : (
      visual
    )
  ) : null;
  const supportingCopy = (
    <>
      <p className="text-fg-muted max-w-130 text-[17px] leading-relaxed text-pretty lg:text-lg">
        {description}
      </p>
      {actions}
      {proof ? (
        <div className="text-fg-subtle border-border-base mt-1 border-t pt-5 text-sm leading-relaxed">
          {proof}
        </div>
      ) : null}
    </>
  );

  return (
    <PageSection
      pad="xl"
      border="b"
      className={cn('relative', split && 'pt-10 sm:pt-14 lg:py-16')}
    >
      {split ? (
        <div
          className={cn(
            'grid min-w-0 items-center gap-10 lg:gap-12 xl:gap-16',
            illustration && 'lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]',
          )}
        >
          <Reveal
            onMount
            className="flex min-w-0 flex-col items-start gap-6 lg:py-4"
          >
            <SectionHeading
              bare
              size="display"
              align="start"
              eyebrow={eyebrow}
              title={title}
              className="[--text-site-display:clamp(2rem,4.6vw,4.5rem)] sm:[--text-site-display:clamp(2.75rem,4.6vw,4.5rem)]"
            />
            {supportingCopy}
          </Reveal>
          {illustration ? (
            <Reveal onMount delay={0.12} className="min-w-0">
              {illustration}
            </Reveal>
          ) : null}
        </div>
      ) : (
        <>
          <div className="relative grid min-w-0 items-end gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-16">
            <SectionHeading
              size="display"
              align="start"
              eyebrow={eyebrow}
              title={title}
              className="[--text-site-display:clamp(2rem,5.8vw,5.25rem)] sm:[--text-site-display:clamp(2.75rem,5.8vw,5.25rem)]"
            />
            <Reveal className="flex max-w-lg min-w-0 flex-col gap-6 lg:pb-1">
              {supportingCopy}
            </Reveal>
          </div>
          {illustration ? (
            <div className="relative mt-10 md:mt-14">{illustration}</div>
          ) : null}
        </>
      )}
    </PageSection>
  );
}
