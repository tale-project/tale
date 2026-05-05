import { Button } from '@tale/ui/button';
import { Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';

import { SiteContainer } from '@/app/components/layout/site-container';
import { useT } from '@/lib/i18n/client';

const easeOut = [0.22, 1, 0.36, 1] as const;

interface Tier {
  key: 'community' | 'pro' | 'enterprise';
  popular?: boolean;
  cta: { kind: 'demo' } | { kind: 'external'; href: string };
}

const TIERS: Tier[] = [
  {
    key: 'community',
    cta: { kind: 'external', href: 'https://docs.tale.dev' },
  },
  { key: 'pro', popular: true, cta: { kind: 'demo' } },
  { key: 'enterprise', cta: { kind: 'demo' } },
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

        <div className="border-border-base mx-auto mt-16 grid max-w-[1120px] grid-cols-1 overflow-hidden border md:grid-cols-3">
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
              className={`border-border-base relative flex flex-col gap-6 border-t p-10 first:border-t-0 md:border-t-0 md:border-l md:first:border-l-0 ${
                tier.popular ? 'bg-bg-elevated' : 'bg-bg-base'
              }`}
            >
              {tier.popular ? (
                <span className="bg-fg-base text-fg-inverse absolute top-6 right-6 rounded-full px-3 py-1 text-xs font-medium">
                  {t('popular')}
                </span>
              ) : null}

              <h2
                className="text-fg-muted text-sm font-medium tracking-wider uppercase"
                style={{ letterSpacing: '0.06em' }}
              >
                {t(`${tier.key}.name`)}
              </h2>

              <div className="flex items-baseline gap-2">
                <span
                  className="text-fg-base text-4xl font-medium md:text-[48px]"
                  style={{ letterSpacing: '-2px', lineHeight: 1.05 }}
                >
                  {t(`${tier.key}.price`)}
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

              <ul
                role="list"
                className="border-border-base mt-2 flex flex-col gap-3 border-t pt-6"
              >
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
