import { buildBreadcrumbListJsonLd } from '@tale/ui/seo/builders/json-ld';
import { useMemo } from 'react';

import { FeatureCapability, FeatureCta } from '@/app/components/blocks/feature';
import {
  CtaPair,
  MarketingCard,
  MarketingExternalLink,
  MarketingPanel,
  MarketingStack,
  PageSection,
  Reveal,
  SectionHeading,
} from '@/app/components/marketing';
import { CONTACT_PATH } from '@/app/content/site-ctas';
import { EXTERNAL_LINKS } from '@/lib/external-links';
import { useT } from '@/lib/i18n/client';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';
import { absoluteLocalizedUrl } from '@/lib/seo/absolute-url';
import { buildTaleOrganizationJsonLd } from '@/lib/seo/organization';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

const FACT_KEYS = ['founded', 'location', 'certified', 'license'] as const;
const PRODUCT_KEYS = [
  'orchestrator',
  'openSource',
  'deployment',
  'beyond',
] as const;
const WORK_KEYS = ['dataQuality', 'regulated', 'edge', 'tailored'] as const;
const VALUE_KEYS = [
  'privacy',
  'neutrality',
  'transparency',
  'control',
] as const;

export function AboutPage() {
  const { t } = useT('about');
  const { t: tSeo } = useT('seo');
  const { t: tAddress } = useT('address');
  const locale = useCurrentLocale();

  // Entity-trust page: re-declare the canonical Organization node (same @id
  // as the homepage) so crawlers merge one publisher entity.
  const jsonLd = useMemo(
    () => [
      buildTaleOrganizationJsonLd(),
      buildBreadcrumbListJsonLd([
        { name: 'Tale', url: absoluteLocalizedUrl(locale, '/') },
        {
          name: tSeo('about.title'),
          url: absoluteLocalizedUrl(locale, '/about'),
        },
      ]),
    ],
    [locale, tSeo],
  );

  useDocumentMeta({
    title: tSeo('about.title'),
    description: tSeo('about.description'),
    path: '/about',
    jsonLd,
  });

  return (
    <>
      <PageSection pad="xl" border="b">
        <MarketingStack max="lg" gap="lg">
          <SectionHeading
            size="display"
            eyebrow={t('hero.eyebrow')}
            title={t('hero.title')}
            description={t('hero.description')}
          />
          <CtaPair
            primary={{ label: t('hero.ctaContact'), to: CONTACT_PATH }}
            secondary={{
              label: t('hero.ctaGithub'),
              href: EXTERNAL_LINKS.github,
            }}
          />
        </MarketingStack>
      </PageSection>

      <PageSection pad="md" border="b">
        <Reveal>
          <MarketingPanel>
            <dl className="bg-border-base grid gap-px sm:grid-cols-2 lg:grid-cols-4">
              {FACT_KEYS.map((key) => (
                <div
                  key={key}
                  className="bg-surface-site-raised px-5 py-6 md:px-6 md:py-7"
                >
                  <dt className="text-fg-subtle text-[13px] font-normal tracking-[0.02em]">
                    {t(`facts.${key}.label`)}
                  </dt>
                  <dd className="text-fg-base mt-1 text-lg tracking-tight">
                    {t(`facts.${key}.value`)}
                  </dd>
                </div>
              ))}
            </dl>
          </MarketingPanel>
        </Reveal>
      </PageSection>

      <PageSection pad="lg" border="b">
        <MarketingStack max="md" gap="md" align="start">
          <SectionHeading
            size="section"
            align="start"
            title={t('story.heading')}
          />
          <Reveal>
            <div className="flex flex-col gap-5">
              <p
                className="text-fg-muted text-base md:text-lg"
                style={{ letterSpacing: '-0.015em', lineHeight: 1.6 }}
              >
                {t('story.p1')}
              </p>
              <p
                className="text-fg-muted text-base md:text-lg"
                style={{ letterSpacing: '-0.015em', lineHeight: 1.6 }}
              >
                {t('story.p2')}
              </p>
              <p
                className="text-fg-base text-xl tracking-[-0.03em] md:text-2xl"
                style={{ lineHeight: 1.2 }}
              >
                {t('story.tagline')}
              </p>
              <p
                className="text-fg-muted text-base md:text-lg"
                style={{ letterSpacing: '-0.015em', lineHeight: 1.6 }}
              >
                {t('story.p3')}
              </p>
              <address
                className="text-sm not-italic"
                style={{ letterSpacing: '-0.14px', lineHeight: 1.5 }}
              >
                <span className="text-fg-muted">
                  {tAddress('company')}
                  {' · '}
                  {tAddress('street')}
                  {' · '}
                  {tAddress('city')}
                  {' · '}
                  {tAddress('country')}
                  {' · '}
                </span>
                <MarketingExternalLink
                  href={EXTERNAL_LINKS.vatCheck}
                  tone="subtle"
                  className="underline"
                >
                  {tAddress('vatId')}
                </MarketingExternalLink>
              </address>
            </div>
          </Reveal>
        </MarketingStack>
      </PageSection>

      <PageSection pad="lg" border="b">
        <MarketingStack max="xl" gap="xl" align="stretch">
          <SectionHeading
            size="section"
            align="start"
            title={t('product.heading')}
            description={t('product.description')}
          />
          <MarketingPanel>
            <ul
              role="list"
              className="bg-border-base grid gap-px sm:grid-cols-2"
            >
              {PRODUCT_KEYS.map((key) => (
                <li key={key} className="bg-surface-site-raised">
                  <MarketingCard
                    title={t(`product.${key}.title`)}
                    description={t(`product.${key}.body`)}
                    className="h-full"
                  />
                </li>
              ))}
            </ul>
          </MarketingPanel>
        </MarketingStack>
      </PageSection>

      <PageSection surface="soft" pad="lg" border="b">
        <MarketingStack max="xl" gap="xl" align="stretch">
          <SectionHeading
            size="section"
            align="start"
            title={t('work.heading')}
            description={t('work.description')}
          />
          <MarketingPanel>
            <ul
              role="list"
              className="bg-border-base grid gap-px sm:grid-cols-2"
            >
              {WORK_KEYS.map((key) => (
                <li key={key} className="bg-surface-site-raised">
                  <MarketingCard
                    title={t(`work.${key}.title`)}
                    description={t(`work.${key}.body`)}
                    className="h-full"
                  />
                </li>
              ))}
            </ul>
          </MarketingPanel>
        </MarketingStack>
      </PageSection>

      <FeatureCapability
        heading={t('values.heading')}
        items={VALUE_KEYS.map((key) => ({
          title: t(`values.${key}.title`),
          body: t(`values.${key}.body`),
        }))}
      />

      <FeatureCta title={t('cta.title')} description={t('cta.description')} />
    </>
  );
}
