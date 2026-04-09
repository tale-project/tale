import { describe, it } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { ContentArea } from './content-area';

describe('ContentArea', () => {
  describe('accessibility', () => {
    it('passes axe audit with default variant', async () => {
      const { container } = render(
        <ContentArea>
          <p>Page content</p>
        </ContentArea>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with narrow variant', async () => {
      const { container } = render(
        <ContentArea variant="narrow">
          <p>Narrow content</p>
        </ContentArea>,
      );
      await checkAccessibility(container);
    });
  });
});
