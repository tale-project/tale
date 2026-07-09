import type { ReactNode } from 'react';

import { DemoStage } from '@/app/components/blocks/demos/demo-stage';
import {
  CtaPair,
  MarketingStack,
  PageSection,
  SectionHeading,
} from '@/app/components/marketing';
import { GET_STARTED_HREF, REQUEST_DEMO_PATH } from '@/app/content/site-ctas';
import { useT } from '@/lib/i18n/client';

interface FeatureHeroProps {
  eyebrow?: string;
  title: string;
  description: string;
  /** Product demo rendered under the heading on an inset DemoStage. */
  visual?: ReactNode;
  showCtas?: boolean;
}

/**
 * Feature-page lead — same composition as homepage HeroHeadline:
 * answer-shaped H1 + CTAs + product stage with DemoShell inside.
 * The stage stays inside SiteContainer, so it uses the inset `section`
 * DemoStage (rounded border) — not the homepage full-bleed `hero` band.
 * Transparent over the root hero wash (do not re-paint `bg-gradient-site-hero`).
 */
export function FeatureHero({
  eyebrow,
  title,
  description,
  visual,
  showCtas = true,
}: FeatureHeroProps) {
  const { t } = useT('featureShared');

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
        {showCtas ? (
          <CtaPair
            primary={{ label: t('ctaGetStarted'), href: GET_STARTED_HREF }}
            secondary={{ label: t('ctaPrimary'), to: REQUEST_DEMO_PATH }}
          />
        ) : null}
      </MarketingStack>
      {visual ? (
        <div className="relative mt-14 md:mt-20">
          <DemoStage variant="section">{visual}</DemoStage>
        </div>
      ) : null}
    </PageSection>
  );
}
