import { Button } from '@tale/ui/button';
import { formatCurrency } from '@tale/ui/format';
import { motion, useReducedMotion } from 'framer-motion';

import {
  clusterMetrics,
  clusterPricing,
  nodeMetrics,
  nodePricing,
  type Pricing,
  type TierMetrics,
} from '@/app/components/blocks/hardware-specs';
import { TierCard } from '@/app/components/blocks/tier-card';
import { LocalizedLink } from '@/app/components/layout/localized-link';
import { SiteContainer } from '@/app/components/layout/site-container';
import { ProgressBar } from '@/app/components/progress-bar';
import type {
  HardwareBilling,
  HardwareMode,
} from '@/app/pages/hardware-pricing-page';
import { useT } from '@/lib/i18n/client';

/**
 * Pricing-card grid + mode/billing toggles — the upper half of the
 * hardware pricing page. All pricing and progress-bar metrics are
 * derived in `hardware-specs.ts`; this component is purely
 * presentational over those derivations.
 */

const easeOut = [0.22, 1, 0.36, 1] as const;
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
  'renting',
] as const satisfies readonly HardwareBilling[];

interface Tier {
  key: TierKey;
  popular: boolean;
  pricing: Record<HardwareMode, Pricing>;
  metrics: Record<HardwareMode, TierMetrics>;
}

const TIERS: Tier[] = TIER_KEYS.map((key) => ({
  key,
  popular: key === 'hybrid',
  pricing: {
    cluster: clusterPricing(key),
    node: nodePricing(key),
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
}

export function HardwareTiers({
  mode,
  onModeChange,
  billing,
  onBillingChange,
}: HardwareTiersProps) {
  const { t } = useT('hardwarePricing');
  const reduceMotion = useReducedMotion();
  const fadeInitial = reduceMotion ? false : { opacity: 0, y: 24 };

  return (
    <section className="border-border-base scroll-mt-16 border-b py-20">
      <SiteContainer>
        <motion.header
          initial={fadeInitial}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-15%' }}
          transition={
            reduceMotion ? { duration: 0 } : { duration: 0.6, ease: easeOut }
          }
          className="mx-auto flex max-w-[720px] flex-col items-center gap-3 text-center"
        >
          <h1
            className="text-fg-base text-3xl font-medium md:text-[52px]"
            style={{ letterSpacing: '-2.14px', lineHeight: 1.077 }}
          >
            {t('title')}
          </h1>
          <p
            className="text-fg-muted max-w-[640px] text-base md:text-lg"
            style={{ letterSpacing: '-0.27px', lineHeight: 1.556 }}
          >
            {t('description')}
          </p>
        </motion.header>

        <div className="mx-auto mt-10 flex flex-col items-center gap-3 md:flex-row md:justify-center md:gap-4">
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
        </div>

        <div className="border-border-base mx-auto mt-12 grid max-w-[1120px] grid-cols-1 overflow-hidden border lg:grid-cols-3">
          {TIERS.map((tier, idx) => {
            const price = formatCurrency(
              billing === 'renting'
                ? tier.pricing[mode].rental
                : tier.pricing[mode].buy,
              {
                currency: HARDWARE_CURRENCY,
                locale: HARDWARE_LOCALE,
                approximate: true,
              },
            );
            const priceSuffix = t(
              billing === 'renting'
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

        <p
          className="text-fg-muted mx-auto mt-10 max-w-[720px] text-center text-sm"
          style={{ letterSpacing: '-0.21px', lineHeight: 1.5 }}
        >
          {t('deploymentNote')}
        </p>
      </SiteContainer>
    </section>
  );
}

interface SegmentedRadioProps<T extends string> {
  ariaLabel: string;
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  renderLabel: (option: T) => string;
}

/**
 * Pill-style radio group used for the mode (node/cluster) and billing
 * (buying/renting) toggles. Kept local since no other block needs it.
 */
function SegmentedRadio<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
  renderLabel,
}: SegmentedRadioProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="bg-bg-elevated flex w-fit items-center gap-1 rounded-md p-0.5"
    >
      {options.map((option) => {
        const isActive = value === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(option)}
            className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors ${
              isActive
                ? 'bg-bg-base text-fg-base shadow-sm'
                : 'text-fg-muted hover:text-fg-base cursor-pointer'
            }`}
          >
            {renderLabel(option)}
          </button>
        );
      })}
    </div>
  );
}
