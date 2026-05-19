import { Button } from '@tale/ui/button';
import { motion, useReducedMotion } from 'framer-motion';

import { LocalizedLink } from '@/components/layout/localized-link';
import { SiteContainer } from '@/components/layout/site-container';
import { useT } from '@/lib/i18n/client';

const easeOut = [0.22, 1, 0.36, 1] as const;

export function CtaDeploy() {
  const { t } = useT('home');
  const reduceMotion = useReducedMotion();

  return (
    <section className="bg-bg-base border-border-strong relative overflow-hidden border-b pt-10 pb-24 md:py-24">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            'repeating-linear-gradient(45deg, var(--color-border-strong) 0, var(--color-border-strong) 2px, transparent 2px, transparent 7px)',
        }}
      />
      <SiteContainer className="relative">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-15%' }}
          transition={
            reduceMotion ? { duration: 0 } : { duration: 0.6, ease: easeOut }
          }
          className="mx-auto flex max-w-[500px] flex-col items-center gap-8 text-center md:gap-10"
        >
          <h2
            className="text-accent-base text-[32px] font-medium tracking-[-0.044em] md:text-[56px] md:tracking-[-0.038em]"
            style={{ lineHeight: 1.071 }}
          >
            {t('cta.title')}
          </h2>
          <Button asChild className="text-base">
            <LocalizedLink to="/request-demo">{t('cta.primary')}</LocalizedLink>
          </Button>
        </motion.div>
      </SiteContainer>
    </section>
  );
}
