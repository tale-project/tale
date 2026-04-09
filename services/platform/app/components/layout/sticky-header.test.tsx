import { describe, it } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

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
