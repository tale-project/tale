import { Bot, LaptopMinimal, ListMinus, Lock } from 'lucide-react';

import { ComplianceTrust } from '@/components/blocks/compliance-trust';
import { CtaDeploy } from '@/components/blocks/cta-deploy';
import { FaqAccordion } from '@/components/blocks/faq-accordion';
import { FeatureGrid } from '@/components/blocks/feature-grid';
import { FeatureSectors } from '@/components/blocks/feature-sectors';
import { FeatureSecure } from '@/components/blocks/feature-secure';
import { HeroHeadline } from '@/components/blocks/hero-headline';
import { LogoWall } from '@/components/blocks/logo-wall';
import { useT } from '@/lib/i18n/client';
import { localizedPath } from '@/lib/i18n/locales';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

export function HomePage() {
  const { t } = useT('home');
  const { t: tNav } = useT('nav');
  const { t: tSeo } = useT('seo');
  const locale = useCurrentLocale();

  useDocumentMeta({
    title: tSeo('home.title'),
    description: tSeo('home.description'),
    canonicalPath: localizedPath(locale, '/'),
  });

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
            illustration: '/marketing/svg/mock-integrations-stack.svg',
          },
          {
            icon: Lock,
            title: t('featureGrid.proven.title'),
            description: t('featureGrid.proven.description'),
            illustration: '/marketing/svg/mock-compliance-columns.svg',
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
