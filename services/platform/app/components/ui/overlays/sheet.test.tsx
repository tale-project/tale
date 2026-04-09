import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { Sheet } from './sheet';

describe('Sheet', () => {
  describe('accessibility', () => {
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
