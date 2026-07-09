import { formatCurrency } from '@tale/ui/format';

import {
  LEASING_TERMS,
  multiNodeBuyPrice,
  multiNodeMetrics,
  leasingMonthly,
  nodeBuyPrice,
  nodeMetrics,
  rackBuyPrice,
  rackMetrics,
  type LeasingTerm,
  type TierMetrics,
} from '@/app/components/blocks/hardware-specs';
import { MarketingSection } from '@/app/components/blocks/marketing-section';
import { SegmentedRadio } from '@/app/components/blocks/segmented-radio';
import { TierCard } from '@/app/components/blocks/tier-card';
import { MarketingButton, MarketingLink } from '@/app/components/marketing';
import { ProgressBar } from '@/app/components/progress-bar';
import { REQUEST_DEMO_PATH } from '@/app/content/site-ctas';
import type {
  HardwareBilling,
  HardwareMode,
} from '@/app/pages/hardware-pricing-page';
import { useT } from '@/lib/i18n/client';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';

/**
 * Pricing-card grid + toggles — the upper half of the hardware pricing
 * page. Tiers expose only their buy price; leasing payments are derived
 * on demand from `(buy, term)` so the rate-table lives in one place.
 */

// Swiss-only product → currency is fixed at CHF, but the number-formatting
// locale follows the page locale so a /de/ visitor sees `CHF 14'990` while
// a /fr/ visitor sees `CHF 14 990` (audit finding R2-B12: previously
// hardcoded to en-US which renders `CHF 14,990` for every locale).
const HARDWARE_CURRENCY = 'CHF';
const HARDWARE_NUMBER_LOCALE: Record<string, string> = {
  en: 'en-CH',
  de: 'de-CH',
  fr: 'fr-CH',
};

const STANDARD_TIER_KEYS = ['quality', 'hybrid', 'speed'] as const;
type StandardTierKey = (typeof STANDARD_TIER_KEYS)[number];
type TierKey = StandardTierKey | 'rack';

const METRIC_AXES = ['quality', 'speed', 'storage'] as const;
const HARDWARE_MODES = [
  'node',
  'multinode',
  'rack',
] as const satisfies readonly HardwareMode[];
const HARDWARE_BILLINGS = [
  'buying',
  'leasing',
] as const satisfies readonly HardwareBilling[];

interface Tier {
  key: TierKey;
  popular: boolean;
  buyPrice: number;
  metrics: TierMetrics;
}

const TIERS_BY_MODE: Record<HardwareMode, Tier[]> = {
  node: STANDARD_TIER_KEYS.map((key) => ({
    key,
    popular: key === 'hybrid',
    buyPrice: nodeBuyPrice(key),
    metrics: nodeMetrics(key),
  })),
  multinode: STANDARD_TIER_KEYS.map((key) => ({
    key,
    popular: key === 'hybrid',
    buyPrice: multiNodeBuyPrice(key),
    metrics: multiNodeMetrics(key),
  })),
  rack: [
    {
      key: 'rack',
      popular: true,
      buyPrice: rackBuyPrice(),
      metrics: rackMetrics(),
    },
  ],
};

interface HardwareTiersProps {
  mode: HardwareMode;
  onModeChange: (mode: HardwareMode) => void;
  billing: HardwareBilling;
  onBillingChange: (billing: HardwareBilling) => void;
  term: LeasingTerm;
  onTermChange: (term: LeasingTerm) => void;
}

export function HardwareTiers({
  mode,
  onModeChange,
  billing,
  onBillingChange,
  term,
  onTermChange,
}: HardwareTiersProps) {
  const { t } = useT('hardwarePricing');
  const locale = useCurrentLocale();
  const numberLocale = HARDWARE_NUMBER_LOCALE[locale] ?? 'en-CH';

  const tiers = TIERS_BY_MODE[mode];
  const isRack = mode === 'rack';

  return (
    <MarketingSection
      title={t('title')}
      description={t('description')}
      controls={
        <div className="flex w-full flex-col items-center gap-3 md:gap-4">
          <SegmentedRadio
            ariaLabel={t('modesAriaLabel')}
            options={HARDWARE_MODES}
            value={mode}
            onChange={onModeChange}
            renderLabel={(option) => t(`modes.${option}`)}
          />
          <div className="flex flex-col items-center gap-3 md:flex-row md:flex-wrap md:justify-center md:gap-4">
            <SegmentedRadio
              ariaLabel={t('billing.ariaLabel')}
              options={HARDWARE_BILLINGS}
              value={billing}
              onChange={onBillingChange}
              renderLabel={(option) => t(`billing.${option}`)}
            />
            {billing === 'leasing' && (
              <div className="flex items-center gap-2">
                <span className="text-fg-muted text-sm">
                  {t('billing.termHeading')}
                </span>
                <SegmentedRadio
                  ariaLabel={t('billing.termAriaLabel')}
                  options={LEASING_TERMS}
                  value={term}
                  onChange={onTermChange}
                  renderLabel={(option) => String(option)}
                />
              </div>
            )}
          </div>
        </div>
      }
      footer={t('deploymentNote')}
    >
      <div
        className={`mx-auto mt-10 grid grid-cols-1 items-stretch gap-4 lg:gap-5 ${
          isRack ? 'max-w-sm' : 'max-w-[1120px] lg:grid-cols-3'
        }`}
      >
        {tiers.map((tier, idx) => {
          const buy = tier.buyPrice;
          const price = formatCurrency(
            billing === 'leasing' ? leasingMonthly(buy, term) : buy,
            {
              currency: HARDWARE_CURRENCY,
              locale: numberLocale,
              approximate: true,
            },
          );
          const priceSuffix = t(
            billing === 'leasing'
              ? `tiers.${tier.key}.priceSuffix`
              : `tiers.${tier.key}.buySuffix`,
          );
          const tagline = t(
            mode === 'node'
              ? `tiers.${tier.key}.nodeTagline`
              : `tiers.${tier.key}.tagline`,
          );

          return (
            <TierCard
              key={tier.key}
              name={t(`tierNames.${mode}.${tier.key}`)}
              popular={tier.popular}
              popularLabel={tier.popular ? t('popular') : undefined}
              price={price}
              priceSuffix={priceSuffix}
              tagline={tagline}
              animationDelay={idx * 0.06}
            >
              <dl className="border-border-base/40 flex flex-col gap-4 border-t pt-5">
                {METRIC_AXES.map((axis) => {
                  const value = tier.metrics[axis];
                  const label = t(`metrics.${axis}`);
                  return (
                    <div key={axis} className="flex flex-col gap-2">
                      <dt className="text-fg-muted text-sm">{label}</dt>
                      <dd>
                        <ProgressBar
                          value={value}
                          ariaLabel={`${label}: ${value}%`}
                        />
                      </dd>
                    </div>
                  );
                })}
              </dl>

              <div className="mt-auto pt-2">
                <MarketingButton
                  asChild
                  tone={tier.popular ? 'primary' : 'secondary'}
                  fullWidth
                >
                  <MarketingLink to={REQUEST_DEMO_PATH} tone="plain">
                    {t(`tiers.${tier.key}.cta`)}
                  </MarketingLink>
                </MarketingButton>
              </div>
            </TierCard>
          );
        })}
      </div>
    </MarketingSection>
  );
}
