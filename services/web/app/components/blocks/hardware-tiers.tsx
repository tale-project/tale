import { Button } from '@tale/ui/button';
import { formatApproximateCurrency } from '@tale/ui/format';
import { Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'framer-motion';
import { useState } from 'react';

import { SiteContainer } from '@/app/components/layout/site-container';
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
    buyAmount: 80_000,
    metrics: { quality: 95, speed: 25, storage: 45 },
  },
  {
    key: 'hybrid',
    rentalAmount: 2100,
    buyAmount: 84_000,
    popular: true,
    metrics: { quality: 60, speed: 60, storage: 60 },
  },
  {
    key: 'speed',
    rentalAmount: 2200,
    buyAmount: 88_000,
    metrics: { quality: 30, speed: 95, storage: 45 },
  },
];

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
            <motion.article
              key={tier.key}
              initial={fadeInitial}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-10%' }}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { duration: 0.5, delay: idx * 0.06, ease: easeOut }
              }
              className={`border-border-base relative flex flex-col gap-6 border-t p-8 first:border-t-0 sm:p-10 lg:border-t-0 lg:border-l lg:first:border-l-0 ${
                tier.popular ? 'bg-bg-elevated' : 'bg-bg-base'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <h2
                  className="text-fg-muted text-lg font-medium"
                  style={{ letterSpacing: '-0.18px' }}
                >
                  {t(`tiers.${tier.key}.name`)}
                </h2>
                {tier.popular ? (
                  <span className="rounded-md bg-[#9bc4ff] px-1.5 py-px text-[10px] font-medium text-[#021a3f]">
                    {t('popular')}
                  </span>
                ) : null}
              </div>

              <div className="flex items-baseline gap-2">
                <span
                  className="text-fg-base text-4xl font-medium md:text-[48px]"
                  style={{ letterSpacing: '-2px', lineHeight: 1.05 }}
                >
                  {formatApproximateCurrency(
                    billing === 'renting' ? tier.rentalAmount : tier.buyAmount,
                    {
                      currency: HARDWARE_CURRENCY,
                      locale: HARDWARE_LOCALE,
                    },
                  )}
                </span>
                <span className="text-fg-muted text-sm">
                  {t(
                    billing === 'renting'
                      ? `tiers.${tier.key}.priceSuffix`
                      : `tiers.${tier.key}.buySuffix`,
                  )}
                </span>
              </div>

              <p
                className="text-fg-muted text-base"
                style={{ letterSpacing: '-0.24px', lineHeight: 1.5 }}
              >
                {t(`tiers.${tier.key}.tagline`)}
              </p>

              <dl className="border-border-base flex flex-col gap-4 border-t pt-6">
                {(['quality', 'speed', 'storage'] as const).map((axis) => (
                  <div key={axis} className="flex flex-col gap-2">
                    <dt className="text-fg-muted text-sm">
                      {t(`metrics.${axis}`)}
                    </dt>
                    <dd
                      className="h-2 overflow-hidden rounded-full bg-gray-200"
                      aria-label={`${t(`metrics.${axis}`)}: ${tier.metrics[axis]}%`}
                    >
                      <div
                        className="h-full rounded-full bg-blue-600"
                        style={{ width: `${tier.metrics[axis]}%` }}
                      />
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="border-border-base mt-auto border-t pt-6">
                <Button
                  asChild
                  variant={tier.popular ? 'primary' : 'secondary'}
                  fullWidth
                >
                  <Link to="/request-demo">{t(`tiers.${tier.key}.cta`)}</Link>
                </Button>
              </div>
            </motion.article>
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
