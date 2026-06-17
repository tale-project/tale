import { describe, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { FullPageCenter } from './full-page-center';

describe('FullPageCenter', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <FullPageCenter>
          <p>Centered content</p>
        </FullPageCenter>,
      );
      await checkAccessibility(container);
    });
  });
});
