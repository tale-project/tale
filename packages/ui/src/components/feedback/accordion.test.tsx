import { describe, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { Accordion, AccordionItem } from './accordion';

describe('Accordion', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <Accordion type="single" defaultOpen="a">
          <AccordionItem id="a" question="First question">
            First answer.
          </AccordionItem>
          <AccordionItem id="b" question="Second question">
            Second answer.
          </AccordionItem>
        </Accordion>,
      );
      await checkAccessibility(container);
    });
  });
});
