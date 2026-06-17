import { describe, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { StickyHeader } from './sticky-header';

describe('StickyHeader', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <StickyHeader>
          <h1>Page Title</h1>
        </StickyHeader>,
      );
      await checkAccessibility(container);
    });
  });
});
