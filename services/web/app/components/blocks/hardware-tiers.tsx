import { Button } from '@tale/ui/button';
import { formatApproximateCurrency } from '@tale/ui/format';
import { Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'framer-motion';
import { useState } from 'react';

import { TierCard } from '@/app/components/blocks/tier-card';
import { SiteContainer } from '@/app/components/layout/site-container';
import { ProgressBar } from '@/app/components/progress-bar';
import { useT } from '@/lib/i18n/client';

const easeOut = [0.22, 1, 0.36, 1] as const;
const HARDWARE_LOCALE = 'en-US';
const HARDWARE_CURRENCY = 'CHF';

type TierKey = 'quality' | 'hybrid' | 'speed';
type BillingMode = 'renting' | 'buying';

interface Tier {
  key: TierKey;
  /** Monthly rental price in CHF (rounded). */
  rentalAmount: number;
  /** One-off purchase price in CHF (rounded). */
  buyAmount: number;
  popular?: boolean;
  /** Score 0–100 for each axis; used to render comparative progress bars. */
  metrics: { quality: number; speed: number; storage: number };
}

const TIERS: Tier[] = [
  {
    key: 'quality',
    rentalAmount: 2000,
    buyAmount: 31_700,
    metrics: { quality: 95, speed: 25, storage: 45 },
  },
  {
    key: 'hybrid',
    rentalAmount: 2100,
    buyAmount: 32_900,
    popular: true,
    metrics: { quality: 60, speed: 60, storage: 60 },
  },
  {
    key: 'speed',
    rentalAmount: 2200,
    buyAmount: 35_300,
    metrics: { quality: 30, speed: 95, storage: 45 },
  },
];

const METRIC_AXES = ['quality', 'speed', 'storage'] as const;

export function HardwareTiers() {
  const { t } = useT('hardwarePricing');
  const reduceMotion = useReducedMotion();
  const fadeInitial = reduceMotion ? false : { opacity: 0, y: 24 };
  const [billing, setBilling] = useState<BillingMode>('renting');

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

        <div
          role="radiogroup"
          aria-label={t('billing.renting')}
          className="bg-bg-elevated mx-auto mt-10 flex w-fit items-center gap-1 rounded-md p-0.5"
        >
          {(['renting', 'buying'] as BillingMode[]).map((mode) => {
            const isActive = billing === mode;
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => setBilling(mode)}
                className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-bg-base text-fg-base shadow-sm'
                    : 'text-fg-muted hover:text-fg-base cursor-pointer'
                }`}
              >
                {t(`billing.${mode}`)}
              </button>
            );
          })}
        </div>

        <div className="border-border-base mx-auto mt-12 grid max-w-[1120px] grid-cols-1 overflow-hidden border lg:grid-cols-3">
          {TIERS.map((tier, idx) => (
            <TierCard
              key={tier.key}
              name={t(`tiers.${tier.key}.name`)}
              popular={tier.popular}
              price={formatApproximateCurrency(
                billing === 'renting' ? tier.rentalAmount : tier.buyAmount,
                {
                  currency: HARDWARE_CURRENCY,
                  locale: HARDWARE_LOCALE,
                },
              )}
              priceSuffix={t(
                billing === 'renting'
                  ? `tiers.${tier.key}.priceSuffix`
                  : `tiers.${tier.key}.buySuffix`,
              )}
              tagline={t(`tiers.${tier.key}.tagline`)}
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
                        value={tier.metrics[axis]}
                        ariaLabel={`${t(`metrics.${axis}`)}: ${tier.metrics[axis]}%`}
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
                  <Link to="/request-demo">{t(`tiers.${tier.key}.cta`)}</Link>
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
