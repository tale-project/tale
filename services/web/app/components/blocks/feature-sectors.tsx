import { Button } from '@tale/ui/button';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CircleDollarSign, Hotel, Scale, type LucideIcon } from 'lucide-react';
import { useState } from 'react';

import { LocalizedLink } from '@/app/components/layout/localized-link';
import { SiteContainer } from '@/app/components/layout/site-container';
import { useT } from '@/lib/i18n/client';

const easeOut = [0.22, 1, 0.36, 1] as const;

type SectorKey = 'hospitality' | 'legal' | 'finance';

const ILLUSTRATIONS: Record<SectorKey, string> = {
  hospitality: '/marketing/svg/mock-product-card.svg',
  legal: '/marketing/svg/mock-document-long.svg',
  finance: '/marketing/svg/mock-document-card.svg',
};

const ICONS: Record<SectorKey, LucideIcon> = {
  hospitality: Hotel,
  legal: Scale,
  finance: CircleDollarSign,
};

export function FeatureSectors() {
  const { t } = useT('home');
  const reduceMotion = useReducedMotion();
  const fadeInitial = reduceMotion ? false : { opacity: 0, y: 24 };
  const [active, setActive] = useState<SectorKey>('hospitality');

  const sectors: { key: SectorKey; label: string; icon: LucideIcon }[] = [
    {
      key: 'hospitality',
      label: t('featureSectors.hospitality.label'),
      icon: ICONS.hospitality,
    },
    {
      key: 'legal',
      label: t('featureSectors.legal.label'),
      icon: ICONS.legal,
    },
    {
      key: 'finance',
      label: t('featureSectors.finance.label'),
      icon: ICONS.finance,
    },
  ];

  return (
    <section className="border-border-base bg-bg-elevated border-b py-20">
      <SiteContainer>
        <motion.div
          initial={fadeInitial}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-15%' }}
          transition={
            reduceMotion ? { duration: 0 } : { duration: 0.6, ease: easeOut }
          }
          className="mx-auto flex max-w-[720px] flex-col items-center gap-3 text-center"
        >
          <h2
            className="text-fg-base text-3xl font-medium md:text-[52px]"
            style={{ letterSpacing: '-2.14px', lineHeight: 1.077 }}
          >
            {t('featureSectors.title')}
          </h2>
          <p
            className="text-fg-muted max-w-[528px] text-base md:text-lg"
            style={{ letterSpacing: '-0.27px', lineHeight: 1.556 }}
          >
            {t('featureSectors.description')}
          </p>
        </motion.div>
      </SiteContainer>

      <SiteContainer>
        <motion.div
          initial={fadeInitial}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-15%' }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { delay: 0.1, duration: 0.7, ease: easeOut }
          }
          className="border-border-base bg-bg-base mx-auto mt-15 max-w-[1120px] overflow-hidden border"
          role="tablist"
          aria-label={t('featureSectors.title')}
        >
          <div className="border-border-base relative grid grid-cols-3 border-b">
            {sectors.map((s) => {
              const isActive = active === s.key;
              const Icon = s.icon;
              return (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActive(s.key)}
                  className={`border-border-base relative flex items-center justify-center gap-2 border-r px-3 py-4 text-base font-medium transition-colors last:border-r-0 ${
                    isActive
                      ? 'text-fg-base bg-bg-base'
                      : 'text-fg-subtle bg-bg-muted hover:bg-bg-elevated cursor-pointer'
                  }`}
                  style={{ letterSpacing: '-0.096px' }}
                >
                  <Icon
                    aria-hidden="true"
                    className="h-3.5 w-3.5 shrink-0"
                    strokeWidth={1.75}
                  />
                  {s.label}
                </button>
              );
            })}
          </div>

          <div className="grid lg:min-h-[500px] lg:grid-cols-[420px_1fr]">
            <div className="relative px-10 py-12">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={active}
                  initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { duration: 0.3, ease: easeOut }
                  }
                  className="flex flex-col items-start gap-6"
                >
                  <h3
                    className="text-fg-base text-2xl font-medium"
                    style={{ letterSpacing: '-0.24px', lineHeight: 1.167 }}
                  >
                    {t(`featureSectors.${active}.label`)}
                  </h3>
                  <p
                    className="text-fg-muted text-lg"
                    style={{ letterSpacing: '-0.27px', lineHeight: 1.778 }}
                  >
                    {t(`featureSectors.${active}.description`)}
                  </p>
                  <Button asChild>
                    <LocalizedLink to="/request-demo">
                      {t('featureSectors.cta')}
                    </LocalizedLink>
                  </Button>
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="border-border-base bg-bg-base relative h-125 overflow-hidden border-t lg:h-auto lg:border-t-0 lg:border-l">
              <AnimatePresence mode="wait" initial={false}>
                <motion.img
                  key={active}
                  src={ILLUSTRATIONS[active]}
                  alt=""
                  aria-hidden
                  draggable={false}
                  initial={reduceMotion ? false : { opacity: 0, scale: 1.02 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={
                    reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }
                  }
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : { duration: 0.4, ease: easeOut }
                  }
                  className="absolute inset-8 m-auto block max-h-[calc(100%-4rem)] max-w-[calc(100%-4rem)] object-contain"
                />
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      </SiteContainer>
    </section>
  );
}
