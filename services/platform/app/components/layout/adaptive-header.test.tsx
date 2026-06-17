import { describe, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import {
  AdaptiveHeaderProvider,
  AdaptiveHeaderRoot,
  AdaptiveHeaderSlot,
  AdaptiveHeaderTitle,
} from './adaptive-header';

describe('AdaptiveHeader', () => {
  describe('accessibility', () => {
    it('AdaptiveHeaderTitle passes axe audit', async () => {
      const { container } = render(
        <AdaptiveHeaderProvider>
          <AdaptiveHeaderRoot>
            <AdaptiveHeaderTitle>Page Title</AdaptiveHeaderTitle>
          </AdaptiveHeaderRoot>
        </AdaptiveHeaderProvider>,
      );
      await checkAccessibility(container);
    });

    it('AdaptiveHeaderSlot passes axe audit', async () => {
      const { container } = render(
        <AdaptiveHeaderProvider>
          <AdaptiveHeaderSlot />
        </AdaptiveHeaderProvider>,
      );
      await checkAccessibility(container);
    });
  });
});
