import { Accordion, AccordionItem } from '@tale/ui/accordion';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';

import { LocalizedLink } from '@/app/components/layout/localized-link';
import { SiteContainer } from '@/app/components/layout/site-container';
import { useT } from '@/lib/i18n/client';
import { useSkipEntrance } from '@/lib/motion/entrance';

const easeOut = [0.22, 1, 0.36, 1] as const;

/**
 * Question order on the page — also the source for the homepage's FAQPage
 * JSON-LD, so schema and visible content cannot diverge.
 */
export const FAQ_KEYS = [
  'whatIsTale',
  'openSource',
  'onPrem',
  'enterprisePricing',
  'enterpriseFeatures',
  'byoModels',
  'aiProviders',
  'hardware',
  'ownHardwareModels',
  'customTraining',
] as const;

export function FaqAccordion() {
  const { t } = useT('home');
  const skipEntrance = useSkipEntrance();

  return (
    <section className="border-border-base bg-surface-site border-b py-12 lg:py-20">
      <SiteContainer>
        <div className="mx-auto grid max-w-[1120px] grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,640px)] lg:gap-10">
          <motion.div
            initial={skipEntrance ? false : { opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-15%' }}
            transition={
              skipEntrance ? { duration: 0 } : { duration: 0.5, ease: easeOut }
            }
          >
            <h2
              className="text-fg-base text-[28px] font-medium tracking-[-0.05em] md:text-[48px] md:tracking-[-0.0446em]"
              style={{ lineHeight: 1.1 }}
            >
              {t('faq.title')}
            </h2>
          </motion.div>

          <motion.div
            initial={skipEntrance ? false : { opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-10%' }}
            transition={
              skipEntrance
                ? { duration: 0 }
                : { delay: 0.08, duration: 0.6, ease: easeOut }
            }
          >
            <Accordion type="multiple">
              {FAQ_KEYS.map((key) => (
                <AccordionItem
                  key={key}
                  id={key}
                  question={t(`faq.${key}.q`)}
                  className="px-0 py-8 lg:px-5 lg:py-5"
                  triggerClassName="text-[18px] tracking-[-1px] lg:text-[20px]"
                  contentClassName="text-[15px] lg:text-[16px]"
                >
                  {t(`faq.${key}.a`)}
                </AccordionItem>
              ))}
            </Accordion>
            <p className="text-fg-subtle mt-6 flex flex-wrap items-center gap-1.5 text-sm">
              <span>{t('faq.stillQuestions')}</span>
              <LocalizedLink
                to="/contact"
                className="text-fg-base inline-flex items-center gap-1 font-medium hover:underline"
              >
                {t('faq.contactTeam')}
                <ArrowRight aria-hidden className="size-3.5" />
              </LocalizedLink>
            </p>
          </motion.div>
        </div>
      </SiteContainer>
    </section>
  );
}
