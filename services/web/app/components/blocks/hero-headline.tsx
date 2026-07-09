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
  const { t: tCert } = useT('complianceTrust');
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
            <span className="border-border-base bg-surface-site-raised text-fg-muted inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium">
              <span
                aria-hidden
                className="bg-brand-base size-1.5 rounded-full"
              />
              {t('hero.badge')}
            </span>
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
            {/* Self-hosted first: the open-source quickstart is the primary
                action; the demo request stays secondary (and in the header). */}
            <Button
              asChild
              className="bg-brand-base hover:bg-brand-strong text-brand-fg rounded-[10px] border-transparent text-base"
            >
              <ExternalLink href={GET_STARTED_URL} showIcon={false}>
                {t('hero.ctaSecondary')}
              </ExternalLink>
            </Button>
            <Button
              asChild
              variant="secondary"
              className="rounded-[10px] text-base"
            >
              <LocalizedLink to="/request-demo">
                {t('hero.ctaPrimary')}
              </LocalizedLink>
            </Button>
          </motion.div>
          <motion.p
            initial={fadeUpInitial}
            animate={{ opacity: 1, y: 0 }}
            transition={
              skipEntrance
                ? { duration: 0 }
                : { delay: 0.25, duration: 0.6, ease: easeOut }
            }
            className="text-fg-subtle text-xs"
          >
            {tCert('certifications.iso27001')} · {tCert('certifications.soc2')}{' '}
            · {tCert('certifications.gdpr')}
          </motion.p>
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
        <div className="relative mx-auto max-w-5xl overflow-hidden rounded-2xl p-2 sm:rounded-3xl sm:p-4 md:p-8">
          {/* Unsplash alpine backdrop (Unsplash License — free commercial
              use), self-hosted; a themed overlay keeps the window legible. */}
          <img
            src="/marketing/hero-bg.webp"
            alt=""
            aria-hidden
            width={1800}
            height={1200}
            loading="eager"
            fetchPriority="high"
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover select-none"
          />
          <div
            aria-hidden
            className="from-surface-site/40 to-surface-site/10 dark:from-surface-site/75 dark:to-surface-site/45 absolute inset-0 bg-gradient-to-b"
          />
          <div className="relative">
            <HeroOrchestration />
          </div>
        </div>
      </motion.div>
    </section>
  );
}
