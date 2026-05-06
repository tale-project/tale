import { Button } from '@tale/ui/button';
import { motion, useReducedMotion } from 'framer-motion';

import { LocalizedLink } from '@/app/components/layout/localized-link';
import { SiteContainer } from '@/app/components/layout/site-container';
import { useT } from '@/lib/i18n/client';

const easeOut = [0.22, 1, 0.36, 1] as const;

export function HeroHeadline() {
  const { t } = useT('home');
  const reduceMotion = useReducedMotion();
  const fadeUpInitial = reduceMotion ? false : { opacity: 0, y: 20 };

  return (
    <section className="border-border-base relative overflow-hidden border-b pt-[60px] pb-4">
      <SiteContainer>
        <div className="mx-auto flex max-w-[700px] flex-col items-center gap-9 text-center">
          <motion.div
            initial={fadeUpInitial}
            animate={{ opacity: 1, y: 0 }}
            transition={
              reduceMotion ? { duration: 0 } : { duration: 0.6, ease: easeOut }
            }
            className="flex flex-col items-center gap-3"
          >
            <h1
              className="text-fg-base text-5xl font-medium md:text-[68px]"
              style={{ letterSpacing: '-2.94px', lineHeight: 1.1176 }}
            >
              {t('hero.title')}
            </h1>
            <p
              className="text-fg-muted max-w-[548px] text-base md:text-xl"
              style={{ letterSpacing: '-0.3px', lineHeight: 1.6 }}
            >
              {t('hero.subtitle')}
            </p>
          </motion.div>
          <motion.div
            initial={fadeUpInitial}
            animate={{ opacity: 1, y: 0 }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { delay: 0.15, duration: 0.6, ease: easeOut }
            }
          >
            <Button asChild>
              <LocalizedLink to="/request-demo">
                {t('hero.ctaPrimary')}
              </LocalizedLink>
            </Button>
          </motion.div>
        </div>
      </SiteContainer>
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 32 }}
        animate={{ opacity: 1, y: 0 }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : { delay: 0.35, duration: 0.8, ease: easeOut }
        }
        className="mx-auto mt-[120px] w-full max-w-[1200px] px-5 md:px-10"
      >
        <img
          src="/marketing/hero-chat.png"
          alt=""
          aria-hidden
          className="w-full select-none"
          loading="eager"
          draggable={false}
        />
      </motion.div>
    </section>
  );
}
