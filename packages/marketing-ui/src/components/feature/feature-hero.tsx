import type { ReactNode } from 'react';

import { DemoStage } from '../demos/demo-stage';
import { PageSection, Reveal, SectionHeading } from '../marketing';

interface FeatureHeroProps {
  eyebrow?: string;
  title: string;
  description: string;
  /** Product demo rendered under the heading on an inset DemoStage. */
  visual?: ReactNode;
  /** CTA row under the copy — typically a `CtaPair` the host feeds its labels and paths. */
  actions?: ReactNode;
}

/**
 * Feature-page lead — answer-shaped H1 + optional CTAs + product stage with
 * a DemoShell inside. The stage stays inside SiteContainer, so it uses the
 * inset `section` DemoStage (rounded border), with quieter spacing than `hero`
 * band. Transparent over the root hero wash (do not re-paint
 * `bg-gradient-site-hero`).
 */
export function FeatureHero({
  eyebrow,
  title,
  description,
  visual,
  actions,
}: FeatureHeroProps) {
  return (
    <PageSection pad="xl" border="b" className="relative overflow-hidden">
      <div className="relative grid min-w-0 items-end gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-16">
        <SectionHeading
          size="display"
          align="start"
          eyebrow={eyebrow}
          title={title}
        />
        <Reveal
          delay={0.1}
          className="flex max-w-lg min-w-0 flex-col gap-7 lg:pb-2"
        >
          <p className="text-fg-muted text-[17px] leading-relaxed text-pretty lg:text-lg">
            {description}
          </p>
          {actions}
        </Reveal>
      </div>
      {visual ? (
        <div className="relative mt-14 md:mt-20">
          <DemoStage variant="section">{visual}</DemoStage>
        </div>
      ) : null}
    </PageSection>
  );
}
