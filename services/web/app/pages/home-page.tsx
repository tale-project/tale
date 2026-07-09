import { ComplianceTrust } from '@/app/components/blocks/compliance-trust';
import { CtaDeploy } from '@/app/components/blocks/cta-deploy';
import { FaqAccordion } from '@/app/components/blocks/faq-accordion';
import { HeroHeadline } from '@/app/components/blocks/hero-headline';
import { IntegrationsBar } from '@/app/components/blocks/integrations-bar';
import { OrchestrationTour } from '@/app/components/blocks/orchestration-tour';
import { Tagline } from '@/app/components/blocks/tagline';
import { useT } from '@/lib/i18n/client';
import { localizedPath } from '@/lib/i18n/locales';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

export function HomePage() {
  const { t: tFooter } = useT('footer');
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

      <section id="features" aria-label={tFooter('features')}>
        <OrchestrationTour />
      </section>

      <Tagline />
      <IntegrationsBar />
      <ComplianceTrust />
      <FaqAccordion />
      <CtaDeploy />
    </>
  );
}
