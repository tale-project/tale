import { ComplianceTrust } from '@/app/components/blocks/compliance-trust';
import { CtaDeploy } from '@/app/components/blocks/cta-deploy';
import { FaqAccordion } from '@/app/components/blocks/faq-accordion';
import { FeatureSecure } from '@/app/components/blocks/feature-secure';
import { HeroHeadline } from '@/app/components/blocks/hero-headline';
import { IntegrationsBar } from '@/app/components/blocks/integrations-bar';
import { Tagline } from '@/app/components/blocks/tagline';
import { useT } from '@/lib/i18n/client';
import { localizedPath } from '@/lib/i18n/locales';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

export function HomePage() {
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
      <Tagline />

      <section id="features" aria-label={tNav('features')}>
        <FeatureSecure />
      </section>

      <IntegrationsBar />
      <ComplianceTrust />
      <FaqAccordion />
      <CtaDeploy />
    </>
  );
}
