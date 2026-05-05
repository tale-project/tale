import { Button } from '@tale/ui/button';
import { Link } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'framer-motion';

import { SiteContainer } from '@/app/components/layout/site-container';
import { useT } from '@/lib/i18n/client';

const easeOut = [0.22, 1, 0.36, 1] as const;

export function CtaDeploy() {
  const { t } = useT('home');
  const reduceMotion = useReducedMotion();

  return (
    <section className="bg-bg-base relative overflow-hidden py-24">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            'repeating-linear-gradient(135deg, var(--color-border-strong) 0, var(--color-border-strong) 1px, transparent 1px, transparent 8px)',
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
          className="mx-auto flex max-w-[500px] flex-col items-center gap-10 text-center"
        >
          <h2
            className="text-fg-base text-4xl font-medium md:text-[56px]"
            style={{ letterSpacing: '-2.14px', lineHeight: 1.071 }}
          >
            {t('cta.title')}
          </h2>
          <Button asChild>
            <Link to="/request-demo">{t('cta.primary')}</Link>
          </Button>
        </motion.div>
      </SiteContainer>
    </section>
  );
}
