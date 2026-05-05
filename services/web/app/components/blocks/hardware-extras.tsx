import { motion, useReducedMotion } from 'framer-motion';

import { SiteContainer } from '@/app/components/layout/site-container';
import { useT } from '@/lib/i18n/client';

const easeOut = [0.22, 1, 0.36, 1] as const;

export function HardwareExtras() {
  const { t } = useT('hardwarePricing');
  const reduceMotion = useReducedMotion();

  return (
    <section className="border-border-base border-b py-20">
      <SiteContainer>
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-10%' }}
          transition={
            reduceMotion ? { duration: 0 } : { duration: 0.5, ease: easeOut }
          }
          className="mx-auto flex max-w-[1120px] flex-col gap-3"
        >
          <h2
            className="text-fg-base text-2xl font-medium md:text-3xl"
            style={{ letterSpacing: '-0.6px', lineHeight: 1.167 }}
          >
            {t('extras.software.title')}
          </h2>
          <p
            className="text-fg-muted max-w-[720px] text-base md:text-lg"
            style={{ letterSpacing: '-0.27px', lineHeight: 1.556 }}
          >
            {t('extras.software.description')}{' '}
            <a
              href="/pricing"
              className="text-fg-base underline underline-offset-4 hover:no-underline"
            >
              {t('extras.software.linkLabel')}
            </a>
            {t('extras.software.suffix')}
          </p>
        </motion.div>
      </SiteContainer>
    </section>
  );
}
