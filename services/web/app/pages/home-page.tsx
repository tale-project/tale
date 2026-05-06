import { ComplianceTrust } from '@/app/components/blocks/compliance-trust';
import { CtaDeploy } from '@/app/components/blocks/cta-deploy';
import { FaqAccordion } from '@/app/components/blocks/faq-accordion';
import { FeatureGrid } from '@/app/components/blocks/feature-grid';
import { FeatureSectors } from '@/app/components/blocks/feature-sectors';
import { FeatureSecure } from '@/app/components/blocks/feature-secure';
import { HeroHeadline } from '@/app/components/blocks/hero-headline';
import { LogoWall } from '@/app/components/blocks/logo-wall';
import {
  BuiltForYouIcon,
  IndependentIcon,
  SecureIcon,
  StackIcon,
} from '@/app/components/icons/marketing-icons';
import { useT } from '@/lib/i18n/client';
import { localizedHref } from '@/lib/i18n/localized-paths';
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
    canonicalPath: localizedHref(locale, '/'),
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
            icon: IndependentIcon,
            title: t('featureGrid.independent.title'),
            description: t('featureGrid.independent.description'),
            illustration: '/marketing/security-1-independent.png',
          },
          {
            icon: StackIcon,
            title: t('featureGrid.stack.title'),
            description: t('featureGrid.stack.description'),
            illustration: '/marketing/svg/mock-integrations-stack.svg',
          },
          {
            icon: SecureIcon,
            title: t('featureGrid.proven.title'),
            description: t('featureGrid.proven.description'),
            illustration: '/marketing/svg/mock-compliance-columns.svg',
          },
          {
            icon: BuiltForYouIcon,
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
