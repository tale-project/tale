import { Button } from '@tale/ui/button';
import { motion } from 'framer-motion';

import { HeroOrchestration } from '@/app/components/blocks/demos/hero-orchestration';
import { ExternalLink } from '@/app/components/layout/external-link';
import { LocalizedLink } from '@/app/components/layout/localized-link';
import { SiteContainer } from '@/app/components/layout/site-container';
import { GET_STARTED_URL } from '@/lib/docs-url';
import { useT } from '@/lib/i18n/client';
import { useSkipEntrance } from '@/lib/motion/entrance';

const easeOut = [0.22, 1, 0.36, 1] as const;

export function HeroHeadline() {
  const { t } = useT('home');
  const skipEntrance = useSkipEntrance();
  const fadeUpInitial = skipEntrance ? false : { opacity: 0, y: 20 };

  return (
    <section className="border-border-base relative overflow-hidden border-b pt-[60px]">
      <SiteContainer>
        <div className="mx-auto flex max-w-[700px] flex-col items-center gap-7 text-center md:gap-9">
          <motion.div
            initial={fadeUpInitial}
            animate={{ opacity: 1, y: 0 }}
            transition={
              skipEntrance ? { duration: 0 } : { duration: 0.6, ease: easeOut }
            }
            className="flex flex-col items-center gap-3"
          >
            <h1
              className="text-fg-base text-[36px] font-medium md:text-[68px]"
              style={{ letterSpacing: '-2.94px', lineHeight: 1.1176 }}
            >
              {t('hero.title')}
            </h1>
            <p
              className="text-fg-muted max-w-180 text-base text-balance md:text-xl"
              style={{ letterSpacing: '-0.3px', lineHeight: 1.6 }}
            >
              {t('hero.subtitle')}
            </p>
          </motion.div>
          <motion.div
            initial={fadeUpInitial}
            animate={{ opacity: 1, y: 0 }}
            transition={
              skipEntrance
                ? { duration: 0 }
                : { delay: 0.15, duration: 0.6, ease: easeOut }
            }
            className="flex flex-wrap items-center justify-center gap-3"
          >
            <Button asChild className="rounded-[10px] text-base">
              <LocalizedLink to="/request-demo">
                {t('hero.ctaPrimary')}
              </LocalizedLink>
            </Button>
            <Button
              asChild
              variant="secondary"
              className="rounded-[10px] text-base"
            >
              <ExternalLink href={GET_STARTED_URL} showIcon={false}>
                {t('hero.ctaSecondary')}
              </ExternalLink>
            </Button>
          </motion.div>
        </div>
      </SiteContainer>
      <motion.div
        initial={skipEntrance ? false : { opacity: 0, y: 32 }}
        animate={{ opacity: 1, y: 0 }}
        transition={
          skipEntrance
            ? { duration: 0 }
            : { delay: 0.35, duration: 0.8, ease: easeOut }
        }
        className="mt-10 w-full px-4 pb-14 md:mt-16 md:px-6 md:pb-20"
      >
        <HeroOrchestration />
      </motion.div>
    </section>
  );
}
