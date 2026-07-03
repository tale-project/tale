import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { Sheet } from './sheet';

describe('Sheet', () => {
  describe('accessibility', () => {
    it('marks the content as a modal dialog (aria-modal)', () => {
      render(
        <Sheet open onOpenChange={vi.fn()} title="Sheet Title">
          <p>Sheet content</p>
        </Sheet>,
      );
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    });

    it('passes axe audit when open', async () => {
      const { container } = render(
        <Sheet
          open={true}
          onOpenChange={vi.fn()}
          title="Sheet Title"
          description="Sheet description"
        >
          <p>Sheet content</p>
        </Sheet>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit without close button', async () => {
      const { container } = render(
        <Sheet open={true} onOpenChange={vi.fn()} title="Sheet Title" hideClose>
          <p>Sheet content</p>
        </Sheet>,
      );
      await checkAccessibility(container);
    });
  });
});
