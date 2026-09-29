import type { ReactNode } from 'react';

import { DemoStage } from '../demos/demo-stage';
import { MarketingStack, PageSection, SectionHeading } from '../marketing';

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
 * inset `section` DemoStage (rounded border) — not the full-bleed `hero`
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
      <MarketingStack max="lg" gap="lg" className="relative">
        <SectionHeading
          size="display"
          eyebrow={eyebrow}
          title={title}
          description={description}
          descriptionClassName="max-w-2xl"
        />
        {actions}
      </MarketingStack>
      {visual ? (
        <div className="relative mt-14 md:mt-20">
          <DemoStage variant="section">{visual}</DemoStage>
        </div>
      ) : null}
    </PageSection>
  );
}
