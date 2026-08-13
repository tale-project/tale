import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, act, screen } from '@/tests/utils/render';

import { DropdownMenu } from './dropdown-menu';

describe('DropdownMenu', () => {
  describe('keepOpen items (in-place drill-down)', () => {
    it('activate via keyboard and keep the menu open', async () => {
      // Drill-down menus (e.g. chat "Move to project") swap the panel's
      // contents on `keepOpen`; the handler must run on keyboard activation,
      // not just pointer, or the item is unreachable for keyboard users.
      const onDrill = vi.fn();
      const { user } = render(
        <DropdownMenu
          open
          onOpenChange={vi.fn()}
          trigger={<button>Open Menu</button>}
          items={[
            [
              {
                type: 'item',
                label: 'Move to project',
                keepOpen: true,
                onClick: onDrill,
              },
              { type: 'item', label: 'Pin', onClick: vi.fn() },
            ],
          ]}
        />,
      );

      const item = screen.getByRole('menuitem', { name: 'Move to project' });
      item.focus();
      await user.keyboard('{Enter}');

      expect(onDrill).toHaveBeenCalledTimes(1);
      // Stayed open (keepOpen): a sibling item is still mounted.
      expect(screen.getByRole('menuitem', { name: 'Pin' })).toBeInTheDocument();
    });

    it('fire exactly once on pointer click (no double-fire)', async () => {
      const onDrill = vi.fn();
      const { user } = render(
        <DropdownMenu
          open
          onOpenChange={vi.fn()}
          trigger={<button>Open Menu</button>}
          items={[
            [
              {
                type: 'item',
                label: 'Move to project',
                keepOpen: true,
                onClick: onDrill,
              },
            ],
          ]}
        />,
      );

      await user.click(
        screen.getByRole('menuitem', { name: 'Move to project' }),
      );
      expect(onDrill).toHaveBeenCalledTimes(1);
    });
  });

  describe('submenus', () => {
    it('portals the submenu so the parent overflow box cannot clip it', async () => {
      const { user } = render(
        <DropdownMenu
          open
          onOpenChange={vi.fn()}
          trigger={<button>Open Menu</button>}
          items={[
            [
              {
                type: 'sub',
                label: 'Reasoning effort',
                items: [[{ type: 'item', label: 'Low', onClick: vi.fn() }]],
              },
            ],
          ]}
        />,
      );

      const parentMenu = screen.getByRole('menu');
      await user.click(
        screen.getByRole('menuitem', { name: 'Reasoning effort' }),
      );

      const low = await screen.findByRole('menuitem', { name: 'Low' });
      expect(document.body.contains(low)).toBe(true);
      expect(parentMenu.contains(low)).toBe(false);
    });
  });

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
