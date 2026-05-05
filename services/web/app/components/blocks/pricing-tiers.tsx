import { Button } from '@tale/ui/button';
import { formatCurrency } from '@tale/ui/format';
import { Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';
import { useState } from 'react';

import { SiteContainer } from '@/app/components/layout/site-container';
import { useT } from '@/lib/i18n/client';

const easeOut = [0.22, 1, 0.36, 1] as const;
const PRICING_LOCALE = 'de-CH';
const PRICING_CURRENCY = 'CHF';

type BillingMode = 'monthly' | 'yearly';

interface Tier {
  key: 'community' | 'pro' | 'enterprise';
  /** `null` = free tier (renders the `community.price` string verbatim). */
  monthlyAmount: number | null;
  popular?: boolean;
  cta: { kind: 'demo' } | { kind: 'external'; href: string };
}

const TIERS: Tier[] = [
  {
    key: 'community',
    monthlyAmount: null,
    cta: { kind: 'external', href: 'https://docs.tale.dev' },
  },
  {
    key: 'pro',
    monthlyAmount: 299,
    popular: true,
    cta: { kind: 'demo' },
  },
  {
    key: 'enterprise',
    monthlyAmount: 1199,
    cta: { kind: 'demo' },
  },
];

const FEATURES_PER_TIER: Record<Tier['key'], string[]> = {
  community: [
    'community.feature1',
    'community.feature2',
    'community.feature3',
    'community.feature4',
  ],
  pro: ['pro.feature1', 'pro.feature2', 'pro.feature3', 'pro.feature4'],
  enterprise: [
    'enterprise.feature1',
    'enterprise.feature2',
    'enterprise.feature3',
    'enterprise.feature4',
    'enterprise.feature5',
    'enterprise.feature6',
  ],
};

export function PricingTiers() {
  const { t } = useT('pricing');
  const reduceMotion = useReducedMotion();
  const fadeInitial = reduceMotion ? false : { opacity: 0, y: 24 };
  const [billing, setBilling] = useState<BillingMode>('monthly');

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
            className="text-fg-muted max-w-[560px] text-base md:text-lg"
            style={{ letterSpacing: '-0.27px', lineHeight: 1.556 }}
          >
            {t('description')}
          </p>
        </motion.header>

        <div
          role="radiogroup"
          aria-label={t('billing.monthly')}
          className="bg-bg-elevated mx-auto mt-10 flex w-fit items-center gap-1 rounded-md p-0.5"
        >
          {(['monthly', 'yearly'] as BillingMode[]).map((mode) => {
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
                  {t(`${tier.key}.name`)}
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
                  {tier.monthlyAmount === null
                    ? t(`${tier.key}.price`)
                    : formatCurrency(
                        billing === 'yearly'
                          ? tier.monthlyAmount * 10
                          : tier.monthlyAmount,
                        {
                          currency: PRICING_CURRENCY,
                          locale: PRICING_LOCALE,
                          maximumFractionDigits: 0,
                        },
                      )}
                </span>
                <span className="text-fg-muted text-sm">
                  {t(`${tier.key}.priceSuffix`)}
                </span>
              </div>

              <p
                className="text-fg-muted text-base"
                style={{ letterSpacing: '-0.24px', lineHeight: 1.5 }}
              >
                {t(`${tier.key}.tagline`)}
              </p>

              <div className="border-border-base flex flex-col gap-3 border-t pt-6">
                <p
                  className="text-fg-base text-sm font-medium"
                  style={{ letterSpacing: '-0.21px', lineHeight: 1.5 }}
                >
                  {t('planIncludes')}
                </p>
                <ul role="list" className="flex flex-col gap-3">
                  {FEATURES_PER_TIER[tier.key].map((featureKey) => (
                    <li
                      key={featureKey}
                      className="text-fg-base flex items-start gap-2 text-sm"
                      style={{ letterSpacing: '-0.21px', lineHeight: 1.5 }}
                    >
                      <Check
                        className="text-fg-base mt-0.5 h-4 w-4 shrink-0"
                        strokeWidth={2}
                        aria-hidden
                      />
                      <span>{t(featureKey)}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-auto pt-2">
                {tier.cta.kind === 'external' ? (
                  <Button asChild variant="secondary" fullWidth>
                    <a
                      href={tier.cta.href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t(`${tier.key}.cta`)}
                    </a>
                  </Button>
                ) : (
                  <Button asChild fullWidth>
                    <Link to="/request-demo">{t(`${tier.key}.cta`)}</Link>
                  </Button>
                )}
              </div>
            </motion.article>
          ))}
        </div>

        <p
          className="text-fg-muted mx-auto mt-10 max-w-[720px] text-center text-sm"
          style={{ letterSpacing: '-0.21px', lineHeight: 1.5 }}
        >
          {t('note')}
        </p>
      </SiteContainer>
    </section>
  );
}
