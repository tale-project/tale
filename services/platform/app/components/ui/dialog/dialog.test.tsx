import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { Dialog } from './dialog';

describe('Dialog', () => {
  describe('back navigation', () => {
    it('renders a back control (labelled) that calls onBack, in every header variant', () => {
      // Consistent regardless of headerActions / icon presence — the back
      // control is a first-class affordance, not a layout side-effect.
      for (const extra of [
        {},
        { headerActions: <button>Act</button> },
        { icon: <span data-testid="ic" /> },
      ]) {
        const onBack = vi.fn();
        const { unmount } = render(
          <Dialog
            open
            onOpenChange={vi.fn()}
            title="Detail"
            description="d"
            onBack={onBack}
            backLabel="Go back"
            {...extra}
          >
            <p>Content</p>
          </Dialog>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
        expect(onBack).toHaveBeenCalledTimes(1);
        unmount();
      }
    });

    it('renders no back control when onBack is absent', () => {
      render(
        <Dialog open onOpenChange={vi.fn()} title="Detail" description="d">
          <p>Content</p>
        </Dialog>,
      );
      expect(
        screen.queryByRole('button', { name: 'Go back' }),
      ).not.toBeInTheDocument();
    });
  });

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
