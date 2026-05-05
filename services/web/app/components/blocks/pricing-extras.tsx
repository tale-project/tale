import { Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, Cloud, GraduationCap, Server } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { SiteContainer } from '@/app/components/layout/site-container';
import { useT } from '@/lib/i18n/client';

const easeOut = [0.22, 1, 0.36, 1] as const;

interface ExtraCard {
  icon: LucideIcon;
  title: string;
  description: string;
  cta?: ReactNode;
}

const TRAINING_HREF =
  'https://app1.edoobox.com/en/Alltron/Network%20and%20server/K%C3%BCnstliche%20Intelligenz';

export function PricingExtras() {
  const { t } = useT('pricing');
  const reduceMotion = useReducedMotion();

  const cards: ExtraCard[] = [
    {
      icon: GraduationCap,
      title: t('extras.training.title'),
      description: t('extras.training.description'),
      cta: (
        <a
          href={TRAINING_HREF}
          target="_blank"
          rel="noopener noreferrer"
          className="text-fg-base hover:text-fg-muted inline-flex items-center gap-1 text-sm font-medium transition-colors"
        >
          {t('extras.training.cta')}
          <ArrowUpRight className="h-4 w-4" aria-hidden />
        </a>
      ),
    },
    {
      icon: Server,
      title: t('extras.hardware.title'),
      description: t('extras.hardware.description'),
      cta: (
        <Link
          to="/hardware-pricing"
          className="text-fg-base hover:text-fg-muted inline-flex items-center gap-1 text-sm font-medium transition-colors"
        >
          {t('extras.hardware.cta')}
          <ArrowUpRight className="h-4 w-4" aria-hidden />
        </Link>
      ),
    },
    {
      icon: Cloud,
      title: t('extras.cloudProviders.title'),
      description: t('extras.cloudProviders.description'),
    },
  ];

  return (
    <section className="border-border-base border-b py-20">
      <SiteContainer>
        <div
          role="list"
          className="border-border-base mx-auto grid max-w-[1120px] grid-cols-1 overflow-hidden border md:grid-cols-3"
        >
          {cards.map((card, idx) => (
            <motion.div
              role="listitem"
              key={card.title}
              initial={reduceMotion ? false : { opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-10%' }}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { duration: 0.5, delay: idx * 0.06, ease: easeOut }
              }
              className="border-border-base flex flex-col gap-4 border-t p-10 first:border-t-0 md:border-t-0 md:border-l md:first:border-l-0"
            >
              <div className="flex items-center gap-2">
                <card.icon
                  className="text-fg-base h-6 w-6 shrink-0"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <h3
                  className="text-fg-base text-2xl font-medium"
                  style={{ letterSpacing: '-0.24px', lineHeight: 1.167 }}
                >
                  {card.title}
                </h3>
              </div>
              <p
                className="text-fg-muted text-lg"
                style={{ letterSpacing: '-0.27px', lineHeight: 1.556 }}
              >
                {card.description}
              </p>
              {card.cta ? <div className="mt-2">{card.cta}</div> : null}
            </motion.div>
          ))}
        </div>
      </SiteContainer>
    </section>
  );
}
