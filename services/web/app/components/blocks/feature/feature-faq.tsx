import { Accordion, AccordionItem } from '@tale/ui/accordion';

import {
  MarketingPanel,
  MarketingStack,
  PageSection,
  SectionHeading,
} from '@/app/components/marketing';

export interface FeatureFaqItem {
  question: string;
  answer: string;
}

interface FeatureFaqProps {
  heading: string;
  items: readonly FeatureFaqItem[];
}

/**
 * Mini-FAQ for feature / compare pages. Answers stay in the DOM (accordion
 * always-mounts content) so FAQPage JSON-LD can match visible text.
 */
export function FeatureFaq({ heading, items }: FeatureFaqProps) {
  if (items.length === 0) return null;

  return (
    <PageSection pad="lg" border="b">
      <MarketingStack max="md" gap="lg" align="stretch">
        <SectionHeading size="subsection" as="h2" title={heading} />
        <MarketingPanel>
          <Accordion
            type="multiple"
            className="divide-border-base rounded-none border-0 bg-transparent shadow-none"
          >
            {items.map((item, index) => (
              <AccordionItem
                key={item.question}
                id={`faq-${index}`}
                question={item.question}
                headingLevel={3}
                className="px-5 md:px-6"
                triggerClassName="text-base md:text-lg"
                contentClassName="text-base"
              >
                {item.answer}
              </AccordionItem>
            ))}
          </Accordion>
        </MarketingPanel>
      </MarketingStack>
    </PageSection>
  );
}
