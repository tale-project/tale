import {
  buildFaqPageJsonLd,
  buildWebSiteJsonLd,
} from '@tale/ui/seo/builders/json-ld';
import { useMemo } from 'react';

import { AgentsBar } from '@/app/components/blocks/agents-bar';
import { ComplianceTrust } from '@/app/components/blocks/compliance-trust';
import { ConnectorsBar } from '@/app/components/blocks/connectors-bar';
import { CtaDeploy } from '@/app/components/blocks/cta-deploy';
import { FAQ_KEYS, FaqAccordion } from '@/app/components/blocks/faq-accordion';
import { HeroHeadline } from '@/app/components/blocks/hero-headline';
import { OrchestrationTour } from '@/app/components/blocks/orchestration-tour';
import { Tagline } from '@/app/components/blocks/tagline';
import { useT } from '@/lib/i18n/client';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';
import { absoluteLocalizedUrl } from '@/lib/seo/absolute-url';
import { buildTaleOrganizationJsonLd } from '@/lib/seo/organization';
import { buildTaleSoftwareApplicationJsonLd } from '@/lib/seo/software-application';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

export function HomePage() {
  const { t: tFooter } = useT('footer');
  const { t: tSeo } = useT('seo');
  const { t: tHome } = useT('home');
  const locale = useCurrentLocale();

  // The homepage's structured-data payload: who makes Tale (Organization),
  // the site (WebSite — no SearchAction, there is no site search), the
  // product with its real prices (SoftwareApplication), and the FAQ exactly
  // as rendered (FAQ_KEYS is shared with the accordion, so schema and
  // visible content cannot diverge). Organization stays on the English
  // entity `@id`; WebSite.url matches this locale's canonical.
  const jsonLd = useMemo(
    () => [
      buildTaleOrganizationJsonLd(),
      buildWebSiteJsonLd({
        name: 'Tale',
        url: absoluteLocalizedUrl(locale, '/'),
      }),
      buildTaleSoftwareApplicationJsonLd(tSeo('home.description')),
      buildFaqPageJsonLd(
        FAQ_KEYS.map((key) => ({
          question: tHome(`faq.${key}.q`),
          answer: tHome(`faq.${key}.a`),
        })),
      ),
    ],
    [locale, tHome, tSeo],
  );

  useDocumentMeta({
    title: tSeo('home.title'),
    description: tSeo('home.description'),
    path: '/',
    jsonLd,
  });

  return (
    <>
      <HeroHeadline />

      <section id="features" aria-label={tFooter('features')}>
        <OrchestrationTour />
      </section>

      <Tagline />
      <AgentsBar />
      <ConnectorsBar />
      <ComplianceTrust />
      <FaqAccordion />
      <CtaDeploy />
    </>
  );
}
