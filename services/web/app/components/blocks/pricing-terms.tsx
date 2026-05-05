import { motion, useReducedMotion } from 'framer-motion';

import { SiteContainer } from '@/app/components/layout/site-container';
import { useT } from '@/lib/i18n/client';

const easeOut = [0.22, 1, 0.36, 1] as const;

const SERVICE_AGREEMENT_HREF = 'https://docs.tale.dev/legal/service-agreement';

export function PricingTerms() {
  const { t } = useT('pricing');
  const reduceMotion = useReducedMotion();

  return (
    <section className="border-border-base border-b py-12">
      <SiteContainer>
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-10%' }}
          transition={
            reduceMotion ? { duration: 0 } : { duration: 0.5, ease: easeOut }
          }
          className="mx-auto flex max-w-[1120px] flex-col gap-3"
        >
          <h2
            className="text-fg-base text-xl font-medium"
            style={{ letterSpacing: '-0.24px', lineHeight: 1.167 }}
          >
            {t('terms.title')}
          </h2>
          <p
            className="text-fg-muted text-base"
            style={{ letterSpacing: '-0.24px', lineHeight: 1.5 }}
          >
            {t('terms.prefix')}{' '}
            <a
              href={SERVICE_AGREEMENT_HREF}
              target="_blank"
              rel="noopener noreferrer"
              className="text-fg-base underline underline-offset-4 hover:no-underline"
            >
              {t('terms.linkLabel')}
            </a>
            {t('terms.suffix')}
          </p>
        </motion.div>
      </SiteContainer>
    </section>
  );
}
