import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

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

    // The title is rendered twice — once by the desktop root, once mirrored
    // into the mobile slot — so the inactive copy must be hidden from the
    // accessibility tree (`aria-hidden`) to avoid a duplicate `h1`. `getByRole`
    // ignores `aria-hidden` subtrees, so exactly one heading must remain.
    it('exposes only one h1 even though the title is mirrored into the slot', () => {
      render(
        <AdaptiveHeaderProvider>
          <AdaptiveHeaderRoot>
            <AdaptiveHeaderTitle>Page Title</AdaptiveHeaderTitle>
          </AdaptiveHeaderRoot>
          <AdaptiveHeaderSlot />
        </AdaptiveHeaderProvider>,
      );
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        'Page Title',
      );
    });
  });
});
