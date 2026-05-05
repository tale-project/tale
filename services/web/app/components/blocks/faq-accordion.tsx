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
    <section className="border-border-base border-b py-20">
      <SiteContainer>
        <div className="mx-auto grid max-w-[1120px] grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,640px)] lg:gap-12">
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
              className="text-fg-base text-3xl font-medium md:text-[48px]"
              style={{ letterSpacing: '-2.14px', lineHeight: 1.083 }}
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
            <Accordion type="multiple">
              {FAQ_KEYS.map((key) => (
                <AccordionItem key={key} id={key} question={t(`faq.${key}.q`)}>
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
