import {
  buildFaqPageJsonLd,
  buildOrganizationJsonLd,
  buildWebSiteJsonLd,
} from '@tale/ui/seo/builders/json-ld';
import { TALE_GITHUB_URL, TALE_SITE_URL } from '@tale/ui/seo/globals';
import { useMemo } from 'react';

import { ComplianceTrust } from '@/app/components/blocks/compliance-trust';
import { CtaDeploy } from '@/app/components/blocks/cta-deploy';
import { FAQ_KEYS, FaqAccordion } from '@/app/components/blocks/faq-accordion';
import { HeroHeadline } from '@/app/components/blocks/hero-headline';
import { IntegrationsBar } from '@/app/components/blocks/integrations-bar';
import { OrchestrationTour } from '@/app/components/blocks/orchestration-tour';
import { Tagline } from '@/app/components/blocks/tagline';
import { useT } from '@/lib/i18n/client';
import { buildTaleSoftwareApplicationJsonLd } from '@/lib/seo/software-application';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

export function HomePage() {
  const { t: tFooter } = useT('footer');
  const { t: tSeo } = useT('seo');
  const { t: tHome } = useT('home');

  // The homepage's structured-data payload: who makes Tale (Organization),
  // the site (WebSite — no SearchAction, there is no site search), the
  // product with its real prices (SoftwareApplication), and the FAQ exactly
  // as rendered (FAQ_KEYS is shared with the accordion, so schema and
  // visible content cannot diverge).
  const jsonLd = useMemo(
    () => [
      buildOrganizationJsonLd({
        id: `${TALE_SITE_URL}/#org`,
        name: 'Tale',
        url: TALE_SITE_URL,
        legalName: 'Ruler GmbH',
        vatID: 'CHE-186.532.610',
        address: {
          streetAddress: 'Seestrasse 4',
          postalCode: '3700',
          addressLocality: 'Spiez',
          addressCountry: 'CH',
        },
        logoUrl: `${TALE_SITE_URL}/favicon-light.png`,
        sameAs: [TALE_GITHUB_URL],
      }),
      buildWebSiteJsonLd({ name: 'Tale', url: TALE_SITE_URL }),
      buildTaleSoftwareApplicationJsonLd(tSeo('home.description')),
      buildFaqPageJsonLd(
        FAQ_KEYS.map((key) => ({
          question: tHome(`faq.${key}.q`),
          answer: tHome(`faq.${key}.a`),
        })),
      ),
    ],
    [tHome, tSeo],
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
      <IntegrationsBar />
      <ComplianceTrust />
      <FaqAccordion />
      <CtaDeploy />
    </>
  );
}
