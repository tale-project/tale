import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, act } from '@/test/utils/render';

import { Popover } from './popover';

describe('Popover', () => {
  describe('accessibility', () => {
    it('passes axe audit with trigger visible', async () => {
      const { container } = render(
        <Popover trigger={<button>Open Popover</button>}>
          <p>Popover content</p>
        </Popover>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when open', async () => {
      let container!: HTMLElement;
      await act(async () => {
        const result = render(
          <Popover
            open={true}
            onOpenChange={vi.fn()}
            trigger={<button>Open Popover</button>}
          >
            <p>Popover content</p>
          </Popover>,
        );
        container = result.container;
      });
      await checkAccessibility(container);
    });
  });
});
