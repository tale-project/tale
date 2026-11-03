import { describe, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { ContentWrapper } from './content-wrapper';

describe('ContentWrapper', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <ContentWrapper>
          <p>Wrapped content</p>
        </ContentWrapper>,
      );
      await checkAccessibility(container);
    });
  });
});
