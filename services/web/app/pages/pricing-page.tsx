import {
  buildBreadcrumbListJsonLd,
  buildFaqPageJsonLd,
} from '@tale/ui/seo/builders/json-ld';
import { useMemo } from 'react';

import { FeatureCta, FeatureFaq } from '@/app/components/blocks/feature';
import { PricingSection } from '@/app/components/blocks/pricing-section';
import {
  MarketingCard,
  MarketingPanel,
  MarketingStack,
  PageSection,
  SectionHeading,
} from '@/app/components/marketing';
import { useT } from '@/lib/i18n/client';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';
import { absoluteLocalizedUrl } from '@/lib/seo/absolute-url';
import { buildTaleSoftwareApplicationJsonLd } from '@/lib/seo/software-application';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

interface FaqItem {
  q: string;
  a: string;
}

export function PricingPage() {
  const { t: tSeo } = useT('seo');
  const { t } = useT('pricingPage');
  const locale = useCurrentLocale();

  const faq = t('faq.items', { returnObjects: true }) as FaqItem[];

  // SoftwareApplication + FAQPage (visible accordion) + breadcrumbs.
  const jsonLd = useMemo(
    () => [
      buildBreadcrumbListJsonLd([
        { name: 'Tale', url: absoluteLocalizedUrl(locale, '/') },
        {
          name: tSeo('pricing.title'),
          url: absoluteLocalizedUrl(locale, '/pricing'),
        },
      ]),
      buildTaleSoftwareApplicationJsonLd(tSeo('pricing.description')),
      buildFaqPageJsonLd(
        faq.map((item) => ({ question: item.q, answer: item.a })),
      ),
    ],
    [faq, locale, tSeo],
  );

  useDocumentMeta({
    title: tSeo('pricing.title'),
    description: tSeo('pricing.description'),
    path: '/pricing',
    jsonLd,
  });

  return (
    <>
      <PricingSection />
      <FeatureFaq
        heading={t('faq.heading')}
        items={faq.map((f) => ({ question: f.q, answer: f.a }))}
      />
      <PageSection surface="soft" pad="xl" border="b">
        <MarketingStack max="xl" gap="xl" align="stretch">
          <SectionHeading
            size="subsection"
            as="h2"
            title={t('relatedHeading')}
            align="start"
          />
          <MarketingPanel>
            <ul
              role="list"
              className="bg-border-base grid gap-px sm:grid-cols-3"
            >
              {(
                [
                  {
                    to: '/hardware-pricing' as const,
                    title: tSeo('hardwarePricing.title'),
                    description: tSeo('hardwarePricing.description'),
                  },
                  {
                    to: '/platform' as const,
                    title: tSeo('platform.title'),
                    description: tSeo('platform.description'),
                  },
                  {
                    to: '/contact' as const,
                    title: tSeo('contact.title'),
                    description: tSeo('contact.description'),
                  },
                ] as const
              ).map((card) => (
                <li key={card.to} className="bg-surface-site-raised">
                  <MarketingCard
                    to={card.to}
                    title={card.title}
                    description={card.description}
                    className="h-full"
                    reveal={false}
                  />
                </li>
              ))}
            </ul>
          </MarketingPanel>
        </MarketingStack>
      </PageSection>
      <FeatureCta title={t('ctaTitle')} description={t('ctaDescription')} />
    </>
  );
}
