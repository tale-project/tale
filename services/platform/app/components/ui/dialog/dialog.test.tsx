import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { Dialog } from './dialog';

describe('Dialog', () => {
  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <Dialog
          open={true}
          onOpenChange={vi.fn()}
          title="Test Dialog"
          description="A test dialog description"
        >
          <p>Dialog content</p>
        </Dialog>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with footer', async () => {
      const { container } = render(
        <Dialog
          open={true}
          onOpenChange={vi.fn()}
          title="Dialog with Footer"
          description="Description"
          footer={<button>Save</button>}
        >
          <p>Content</p>
        </Dialog>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with custom header', async () => {
      const { container } = render(
        <Dialog
          open={true}
          onOpenChange={vi.fn()}
          title="Hidden Title"
          customHeader={<div>Custom Header</div>}
        >
          <p>Content</p>
        </Dialog>,
      );
      await checkAccessibility(container);
    });
  });
});
