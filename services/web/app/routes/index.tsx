import { createFileRoute } from '@tanstack/react-router';
import { Bot, LaptopMinimal, ListMinus, Lock } from 'lucide-react';

import { ComplianceTrust } from '@/app/components/blocks/compliance-trust';
import { CtaDeploy } from '@/app/components/blocks/cta-deploy';
import { FaqAccordion } from '@/app/components/blocks/faq-accordion';
import { FeatureGrid } from '@/app/components/blocks/feature-grid';
import { FeatureSectors } from '@/app/components/blocks/feature-sectors';
import { FeatureSecure } from '@/app/components/blocks/feature-secure';
import { HeroHeadline } from '@/app/components/blocks/hero-headline';
import { LogoWall } from '@/app/components/blocks/logo-wall';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute('/')({
  component: IndexPage,
});

function IndexPage() {
  const { t } = useT('home');
  const { t: tNav } = useT('nav');

  return (
    <>
      <HeroHeadline />
      <LogoWall />

      <section id="features" aria-label={tNav('features')}>
        <FeatureSecure />
        <FeatureSectors />
      </section>

      <FeatureGrid
        title={t('featureGrid.title')}
        description={t('featureGrid.description')}
        items={[
          {
            icon: ListMinus,
            title: t('featureGrid.independent.title'),
            description: t('featureGrid.independent.description'),
            illustration: '/marketing/security-1-independent.png',
          },
          {
            icon: Bot,
            title: t('featureGrid.stack.title'),
            description: t('featureGrid.stack.description'),
            illustration: '/marketing/security-2-stack.png',
          },
          {
            icon: Lock,
            title: t('featureGrid.proven.title'),
            description: t('featureGrid.proven.description'),
            illustration: '/marketing/security-3-proven.png',
          },
          {
            icon: LaptopMinimal,
            title: t('featureGrid.needs.title'),
            description: t('featureGrid.needs.description'),
            illustration: '/marketing/security-4-needs.png',
          },
        ]}
      />

      <ComplianceTrust />
      <FaqAccordion />
      <CtaDeploy />
    </>
  );
}
