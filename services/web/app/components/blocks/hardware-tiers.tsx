import { Button } from '@tale/ui/button';
import { formatCurrency } from '@tale/ui/format';
import { motion, useReducedMotion } from 'framer-motion';

import { TierCard } from '@/app/components/blocks/tier-card';
import { LocalizedLink } from '@/app/components/layout/localized-link';
import { SiteContainer } from '@/app/components/layout/site-container';
import { ProgressBar } from '@/app/components/progress-bar';
import type {
  HardwareBilling,
  HardwareMode,
} from '@/app/pages/hardware-pricing-page';
import { useT } from '@/lib/i18n/client';

const easeOut = [0.22, 1, 0.36, 1] as const;
const HARDWARE_LOCALE = 'en-US';
const HARDWARE_CURRENCY = 'CHF';

type TierKey = 'quality' | 'hybrid' | 'speed';

interface TierMetrics {
  quality: number;
  speed: number;
  storage: number;
}

interface TierPricing {
  /** Monthly rental price in CHF (rounded). */
  rental: number;
  /** One-off purchase price in CHF (rounded). */
  buy: number;
}

interface Tier {
  key: TierKey;
  popular?: boolean;
  /** Rental + buy prices, per mode. */
  pricing: Record<HardwareMode, TierPricing>;
  /** Score 0–100 per mode and axis; rendered as comparative progress bars. */
  metrics: Record<HardwareMode, TierMetrics>;
}

const TIERS: Tier[] = [
  {
    key: 'quality',
    pricing: {
      cluster: { rental: 2800, buy: 55_700 },
      node: { rental: 300, buy: 4000 },
    },
    metrics: {
      cluster: { quality: 100, speed: 25, storage: 100 },
      node: { quality: 67, speed: 17, storage: 6 },
    },
  },
  {
    key: 'hybrid',
    popular: true,
    pricing: {
      cluster: { rental: 2800, buy: 55_700 },
      node: { rental: 500, buy: 8800 },
    },
    metrics: {
      cluster: { quality: 75, speed: 50, storage: 100 },
      node: { quality: 0, speed: 0, storage: 100 },
    },
  },
  {
    key: 'speed',
    pricing: {
      cluster: { rental: 2800, buy: 55_700 },
      node: { rental: 800, buy: 14_600 },
    },
    metrics: {
      cluster: { quality: 25, speed: 100, storage: 100 },
      node: { quality: 17, speed: 67, storage: 22 },
    },
  },
];

const METRIC_AXES = ['quality', 'speed', 'storage'] as const;
const HARDWARE_MODES = [
  'node',
  'cluster',
] as const satisfies readonly HardwareMode[];
const HARDWARE_BILLINGS = [
  'buying',
  'renting',
] as const satisfies readonly HardwareBilling[];

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
          <div
            role="radiogroup"
            aria-label={t('modesAriaLabel')}
            className="bg-bg-elevated flex w-fit items-center gap-1 rounded-md p-0.5"
          >
            {HARDWARE_MODES.map((option) => {
              const isActive = mode === option;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => onModeChange(option)}
                  className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-bg-base text-fg-base shadow-sm'
                      : 'text-fg-muted hover:text-fg-base cursor-pointer'
                  }`}
                >
                  {t(`modes.${option}`)}
                </button>
              );
            })}
          </div>

          <div
            role="radiogroup"
            aria-label={t('billing.ariaLabel')}
            className="bg-bg-elevated flex w-fit items-center gap-1 rounded-md p-0.5"
          >
            {HARDWARE_BILLINGS.map((option) => {
              const isActive = billing === option;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => onBillingChange(option)}
                  className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-bg-base text-fg-base shadow-sm'
                      : 'text-fg-muted hover:text-fg-base cursor-pointer'
                  }`}
                >
                  {t(`billing.${option}`)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="border-border-base mx-auto mt-12 grid max-w-[1120px] grid-cols-1 overflow-hidden border lg:grid-cols-3">
          {TIERS.map((tier, idx) => (
            <TierCard
              key={tier.key}
              name={t(`tierNames.${mode}.${tier.key}`)}
              popular={tier.popular}
              price={formatCurrency(
                billing === 'renting'
                  ? tier.pricing[mode].rental
                  : tier.pricing[mode].buy,
                {
                  currency: HARDWARE_CURRENCY,
                  locale: HARDWARE_LOCALE,
                  approximate: true,
                },
              )}
              priceSuffix={t(
                billing === 'renting'
                  ? `tiers.${tier.key}.priceSuffix`
                  : `tiers.${tier.key}.buySuffix`,
              )}
              tagline={t(
                mode === 'node'
                  ? `tiers.${tier.key}.nodeTagline`
                  : `tiers.${tier.key}.tagline`,
              )}
              animationDelay={idx * 0.06}
            >
              <dl className="border-border-base flex flex-col gap-4 border-t pt-6">
                {METRIC_AXES.map((axis) => (
                  <div key={axis} className="flex flex-col gap-2">
                    <dt className="text-fg-muted text-sm">
                      {t(`metrics.${axis}`)}
                    </dt>
                    <dd>
                      <ProgressBar
                        value={tier.metrics[mode][axis]}
                        ariaLabel={`${t(`metrics.${axis}`)}: ${tier.metrics[mode][axis]}%`}
                      />
                    </dd>
                  </div>
                ))}
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
          ))}
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
