import { HomeHeroDemo } from '@/app/components/blocks/demos/content';
import { DemoStage } from '@/app/components/blocks/demos/demo-stage';
import { TrustCertifications } from '@/app/components/blocks/trust-certifications';
import { SiteContainer } from '@/app/components/layout/site-container';
import {
  CtaPair,
  MarketingStack,
  Reveal,
  SectionHeading,
} from '@/app/components/marketing';
import { CONTACT_PATH, REQUEST_DEMO_PATH } from '@/app/content/site-ctas';
import { useT } from '@/lib/i18n/client';

/**
 * Homepage hero — Cursor-style left-aligned composition: brand-scale
 * headline, dual CTAs, trust line, then a full-bleed product stage.
 */
export function HeroHeadline() {
  const { t } = useT('home');

  return (
    <section className="relative overflow-hidden pt-14 md:pt-24">
      <SiteContainer className="relative">
        <MarketingStack max="xl" gap="md" align="start" className="max-w-3xl">
          <Reveal onMount y={16} duration={0.65}>
            <SectionHeading
              bare
              size="display"
              align="start"
              title={t('hero.title')}
              description={t('hero.subtitle')}
            />
          </Reveal>
          <Reveal onMount y={16} delay={0.1} duration={0.6}>
            <CtaPair
              align="start"
              primary={{
                label: t('hero.ctaPrimary'),
                to: REQUEST_DEMO_PATH,
              }}
              secondary={{
                label: t('hero.ctaSecondary'),
                to: CONTACT_PATH,
              }}
            />
          </Reveal>
          <Reveal onMount y={12} delay={0.18} duration={0.6}>
            <TrustCertifications variant="line" />
          </Reveal>
        </MarketingStack>
      </SiteContainer>
      <Reveal
        onMount
        y={28}
        delay={0.22}
        duration={0.85}
        className="relative mt-16 w-full md:mt-24"
      >
        <DemoStage variant="hero">
          <HomeHeroDemo />
        </DemoStage>
      </Reveal>
    </section>
  );
}
