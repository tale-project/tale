import { Button } from '@tale/ui/button';
import { formatCurrency } from '@tale/ui/format';

import type {
  HardwareBilling,
  HardwareMode,
} from '@/app/pages/hardware-pricing-page';
import {
  LEASING_TERMS,
  clusterBuyPrice,
  clusterMetrics,
  leasingMonthly,
  nodeBuyPrice,
  nodeMetrics,
  type LeasingTerm,
  type TierMetrics,
} from '@/components/blocks/hardware-specs';
import { MarketingSection } from '@/components/blocks/marketing-section';
import { SegmentedRadio } from '@/components/blocks/segmented-radio';
import { TierCard } from '@/components/blocks/tier-card';
import { LocalizedLink } from '@/components/layout/localized-link';
import { ProgressBar } from '@/components/progress-bar';
import { useT } from '@/lib/i18n/client';

/**
 * Pricing-card grid + toggles — the upper half of the hardware pricing
 * page. Tiers expose only their buy price; leasing payments are derived
 * on demand from `(buy, term)` so the rate-table lives in one place.
 */

const HARDWARE_LOCALE = 'en-US';
const HARDWARE_CURRENCY = 'CHF';

const TIER_KEYS = ['quality', 'hybrid', 'speed'] as const;
type TierKey = (typeof TIER_KEYS)[number];

const METRIC_AXES = ['quality', 'speed', 'storage'] as const;
const HARDWARE_MODES = [
  'node',
  'cluster',
] as const satisfies readonly HardwareMode[];
const HARDWARE_BILLINGS = [
  'buying',
  'leasing',
] as const satisfies readonly HardwareBilling[];

interface Tier {
  key: TierKey;
  popular: boolean;
  buyPrice: Record<HardwareMode, number>;
  metrics: Record<HardwareMode, TierMetrics>;
}

const TIERS: Tier[] = TIER_KEYS.map((key) => ({
  key,
  popular: key === 'hybrid',
  buyPrice: {
    cluster: clusterBuyPrice(key),
    node: nodeBuyPrice(key),
  },
  metrics: {
    cluster: clusterMetrics(key),
    node: nodeMetrics(key),
  },
}));

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

  return (
    <MarketingSection
      title={t('title')}
      description={t('description')}
      descriptionMaxWidth={640}
      controls={
        <>
          <SegmentedRadio
            ariaLabel={t('modesAriaLabel')}
            options={HARDWARE_MODES}
            value={mode}
            onChange={onModeChange}
            renderLabel={(option) => t(`modes.${option}`)}
          />
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
        </>
      }
      footer={t('deploymentNote')}
    >
      <div className="border-border-base mx-auto mt-12 grid max-w-[1120px] grid-cols-1 overflow-hidden border lg:grid-cols-3">
        {TIERS.map((tier, idx) => {
          const buy = tier.buyPrice[mode];
          const price = formatCurrency(
            billing === 'leasing' ? leasingMonthly(buy, term) : buy,
            {
              currency: HARDWARE_CURRENCY,
              locale: HARDWARE_LOCALE,
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
              price={price}
              priceSuffix={priceSuffix}
              tagline={tagline}
              animationDelay={idx * 0.06}
            >
              <dl className="border-border-base flex flex-col gap-4 border-t pt-6">
                {METRIC_AXES.map((axis) => {
                  const value = tier.metrics[mode][axis];
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
                <Button
                  asChild
                  variant={tier.popular ? 'primary' : 'secondary'}
                  fullWidth
                >
                  <LocalizedLink to="/request-demo">
                    {t(`tiers.${tier.key}.cta`)}
                  </LocalizedLink>
                </Button>
              </div>
            </TierCard>
          );
        })}
      </div>
    </MarketingSection>
  );
}
