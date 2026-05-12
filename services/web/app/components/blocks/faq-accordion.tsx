import { Accordion, AccordionItem } from '@tale/ui/accordion';
import { motion, useReducedMotion } from 'framer-motion';

import { SiteContainer } from '@/app/components/layout/site-container';
import { useT } from '@/lib/i18n/client';

const easeOut = [0.22, 1, 0.36, 1] as const;

const FAQ_KEYS = [
  'sovereignty',
  'dataResidency',
  'deployment',
  'cloudProviders',
  'pricing',
  'integrations',
  'support',
] as const;

export function FaqAccordion() {
  const { t } = useT('home');
  const reduceMotion = useReducedMotion();

  return (
    <section className="border-border-base border-b py-12 lg:py-20">
      <SiteContainer>
        <div className="mx-auto grid max-w-[1120px] grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,640px)] lg:gap-10">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-15%' }}
            transition={
              reduceMotion ? { duration: 0 } : { duration: 0.5, ease: easeOut }
            }
            className="lg:pl-10"
          >
            <h2
              className="text-fg-base text-[28px] font-medium tracking-[-0.05em] md:text-[48px] md:tracking-[-0.0446em]"
              style={{ lineHeight: 1.1 }}
            >
              {t('faq.title')}
            </h2>
          </motion.div>

          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-10%' }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { delay: 0.08, duration: 0.6, ease: easeOut }
            }
          >
            <Accordion
              type="multiple"
              className="[&_[id$='-content']_div]:!text-[15px] lg:[&_[id$='-content']_div]:!text-[16px] [&_button]:!text-[18px] lg:[&_button]:!text-[20px] [&_button>span]:!text-[18px] lg:[&_button>span]:!text-[20px]"
            >
              {FAQ_KEYS.map((key) => (
                <AccordionItem
                  key={key}
                  id={key}
                  question={t(`faq.${key}.q`)}
                  className="px-0 py-8 lg:px-5 lg:py-5"
                >
                  {t(`faq.${key}.a`)}
                </AccordionItem>
              ))}
            </Accordion>
          </motion.div>
        </div>
      </SiteContainer>
    </section>
  );
}
