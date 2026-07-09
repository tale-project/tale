import { buildBreadcrumbListJsonLd } from '@tale/ui/seo/builders/json-ld';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';

import { FeatureCta } from '@/app/components/blocks/feature';
import { HardwareCompare } from '@/app/components/blocks/hardware-compare';
import {
  LEASING_TERMS,
  type LeasingTerm,
} from '@/app/components/blocks/hardware-specs';
import { HardwareTiers } from '@/app/components/blocks/hardware-tiers';
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
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

export type HardwareMode = 'node' | 'multinode' | 'rack';
export type HardwareBilling = 'leasing' | 'buying';

const DEFAULT_TERM: LeasingTerm = 36;

function isHardwareMode(value: unknown): value is HardwareMode {
  return value === 'node' || value === 'multinode' || value === 'rack';
}

function isHardwareBilling(value: unknown): value is HardwareBilling {
  return value === 'leasing' || value === 'buying';
}

function parseLeasingTerm(value: unknown): LeasingTerm | undefined {
  const num = typeof value === 'string' ? Number(value) : value;
  if (typeof num !== 'number' || !Number.isInteger(num)) return undefined;
  return LEASING_TERMS.find((t) => t === num);
}

export function HardwarePricingPage() {
  const { t: tSeo } = useT('seo');
  const { t } = useT('pricingPage');
  const locale = useCurrentLocale();
  const search: Record<string, unknown> = useSearch({ strict: false });
  const navigate = useNavigate();

  const mode: HardwareMode = isHardwareMode(search.mode) ? search.mode : 'node';
  const billing: HardwareBilling = isHardwareBilling(search.billing)
    ? search.billing
    : 'buying';
  const term: LeasingTerm = parseLeasingTerm(search.term) ?? DEFAULT_TERM;

  const jsonLd = useMemo(
    () => [
      buildBreadcrumbListJsonLd([
        { name: 'Tale', url: absoluteLocalizedUrl(locale, '/') },
        {
          name: tSeo('hardwarePricing.title'),
          url: absoluteLocalizedUrl(locale, '/hardware-pricing'),
        },
      ]),
    ],
    [locale, tSeo],
  );

  useDocumentMeta({
    title: tSeo('hardwarePricing.title'),
    description: tSeo('hardwarePricing.description'),
    path: '/hardware-pricing',
    jsonLd,
  });

  const setMode = (next: HardwareMode) =>
    navigate({
      to: '.',
      search: (prev) => ({
        ...prev,
        mode: next === 'node' ? undefined : next,
      }),
      replace: true,
      resetScroll: false,
    });

  const setBilling = (next: HardwareBilling) =>
    navigate({
      to: '.',
      search: (prev) => ({
        ...prev,
        billing: next === 'buying' ? undefined : next,
      }),
      replace: true,
      resetScroll: false,
    });

  const setTerm = (next: LeasingTerm) =>
    navigate({
      to: '.',
      search: (prev) => ({
        ...prev,
        term: next === DEFAULT_TERM ? undefined : next,
      }),
      replace: true,
      resetScroll: false,
    });

  return (
    <>
      <HardwareTiers
        mode={mode}
        billing={billing}
        term={term}
        onModeChange={setMode}
        onBillingChange={setBilling}
        onTermChange={setTerm}
      />
      <HardwareCompare mode={mode} />
      <PageSection pad="lg" border="b">
        <MarketingStack max="xl" gap="lg" align="stretch">
          <SectionHeading
            size="subsection"
            as="h2"
            title={t('relatedHeading')}
          />
          <MarketingPanel>
            <ul
              role="list"
              className="bg-border-base grid gap-px sm:grid-cols-3"
            >
              <li className="bg-surface-site-raised">
                <MarketingCard
                  to="/pricing"
                  title={tSeo('pricing.title')}
                  description={tSeo('pricing.description')}
                  className="h-full"
                />
              </li>
              <li className="bg-surface-site-raised">
                <MarketingCard
                  to="/platform"
                  title={tSeo('platform.title')}
                  description={tSeo('platform.description')}
                  className="h-full"
                />
              </li>
              <li className="bg-surface-site-raised">
                <MarketingCard
                  to="/contact"
                  title={tSeo('contact.title')}
                  description={tSeo('contact.description')}
                  className="h-full"
                />
              </li>
            </ul>
          </MarketingPanel>
        </MarketingStack>
      </PageSection>
      <FeatureCta title={t('ctaTitle')} description={t('ctaDescription')} />
    </>
  );
}
