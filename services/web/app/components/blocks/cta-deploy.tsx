import { Button } from '@tale/ui/button';
import { motion, useReducedMotion } from 'framer-motion';

import { ExternalLink } from '@/app/components/layout/external-link';
import { LocalizedLink } from '@/app/components/layout/localized-link';
import { SiteContainer } from '@/app/components/layout/site-container';
import { DOCS_URL } from '@/lib/docs-url';
import { useT } from '@/lib/i18n/client';

const easeOut = [0.22, 1, 0.36, 1] as const;

export function CtaDeploy() {
  const { t } = useT('home');
  const reduceMotion = useReducedMotion();

  return (
    <section className="bg-bg-base relative overflow-hidden py-20 md:py-24 dark:bg-[#111113]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-20 dark:opacity-[0.08]"
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
          className="mx-auto flex max-w-125 flex-col items-center gap-8 text-center md:gap-10"
        >
          <h2
            className="text-fg-base text-[32px] font-medium tracking-[-0.044em] whitespace-nowrap md:text-[56px] md:tracking-[-0.038em]"
            style={{ lineHeight: 1.071 }}
          >
            {t('cta.title')}
          </h2>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button asChild>
              <LocalizedLink to="/request-demo">
                {t('cta.primary')}
              </LocalizedLink>
            </Button>
            <Button asChild variant="secondary">
              <ExternalLink href={DOCS_URL} showIcon={false}>
                {t('cta.secondary')}
              </ExternalLink>
            </Button>
          </div>
        </motion.div>
      </SiteContainer>
    </section>
  );
}
