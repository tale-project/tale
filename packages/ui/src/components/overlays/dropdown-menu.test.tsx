import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, act } from '@/test/utils/render';

import { DropdownMenu } from './dropdown-menu';

describe('DropdownMenu', () => {
  describe('accessibility', () => {
    it('passes axe audit with trigger visible', async () => {
      const { container } = render(
        <DropdownMenu
          trigger={<button>Open Menu</button>}
          items={[
            [
              { type: 'item', label: 'Edit', onClick: vi.fn() },
              { type: 'item', label: 'Delete', onClick: vi.fn() },
            ],
          ]}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when open', async () => {
      let container!: HTMLElement;
      await act(async () => {
        const result = render(
          <DropdownMenu
            open={true}
            onOpenChange={vi.fn()}
            trigger={<button>Open Menu</button>}
            items={[
              [
                { type: 'item', label: 'View', onClick: vi.fn() },
                {
                  type: 'item',
                  label: 'Remove',
                  onClick: vi.fn(),
                  destructive: true,
                },
              ],
            ]}
          />,
        );
        container = result.container;
      });
      await checkAccessibility(container);
    });
  });
});
