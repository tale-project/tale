import { Accordion, AccordionItem } from '@tale/ui/accordion';
import { ArrowRight } from 'lucide-react';

import { LocalizedLink } from '@/app/components/layout/localized-link';
import {
  MarketingStack,
  PageSection,
  Reveal,
  SectionHeading,
} from '@/app/components/marketing';
import { CONTACT_PATH } from '@/app/content/site-ctas';
import { useT } from '@/lib/i18n/client';

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

  return (
    <PageSection surface="site" pad="xl" border="b">
      <div className="mx-auto grid max-w-[1120px] grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,640px)] lg:items-start lg:gap-14">
        <Reveal>
          <MarketingStack max="full" gap="md" align="start">
            <SectionHeading
              bare
              size="section"
              align="start"
              title={t('faq.title')}
            />
            <p className="text-fg-subtle flex flex-wrap items-center gap-1.5 text-sm">
              <span>{t('faq.stillQuestions')}</span>
              <LocalizedLink
                to={CONTACT_PATH}
                className="text-fg-base inline-flex items-center gap-1 font-medium hover:underline"
              >
                {t('faq.contactTeam')}
                <ArrowRight aria-hidden className="size-3.5" />
              </LocalizedLink>
            </p>
          </MarketingStack>
        </Reveal>

        <Reveal delay={0.08}>
          <Accordion
            type="multiple"
            className="bg-surface-site-raised shadow-site-card"
          >
            {FAQ_KEYS.map((key) => (
              <AccordionItem
                key={key}
                id={key}
                question={t(`faq.${key}.q`)}
                triggerClassName="text-[17px] tracking-tight md:text-[19px]"
                contentClassName="text-[15px] md:text-base"
              >
                {t(`faq.${key}.a`)}
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </div>
    </PageSection>
  );
}
