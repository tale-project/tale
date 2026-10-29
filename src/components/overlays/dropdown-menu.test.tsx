import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, act, screen } from '@/tests/utils/render';

import { DropdownMenu } from './dropdown-menu';

describe('DropdownMenu', () => {
  it('builds lazy choices only when opened and keeps them current', async () => {
    const onSelect = vi.fn();
    const items = vi.fn(() => [
      [{ type: 'item' as const, label: 'First project', onClick: onSelect }],
    ]);
    const { user, rerender } = render(
      <DropdownMenu trigger={<button>Projects</button>} items={items} />,
    );
    expect(items).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Projects' }));
    expect(items).toHaveBeenCalled();
    expect(
      screen.getByRole('menuitem', { name: 'First project' }),
    ).toBeInTheDocument();

    const updatedItems = vi.fn(() => [
      [{ type: 'item' as const, label: 'Updated project', onClick: onSelect }],
    ]);
    rerender(
      <DropdownMenu trigger={<button>Projects</button>} items={updatedItems} />,
    );
    await user.click(screen.getByRole('menuitem', { name: 'Updated project' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('does not build a lazy submenu until its trigger opens', async () => {
    const submenu = vi.fn(() => [
      [{ type: 'item' as const, label: 'Destination' }],
    ]);
    const { user } = render(
      <DropdownMenu
        open
        trigger={<button>Actions</button>}
        items={[[{ type: 'sub', label: 'Move', items: submenu }]]}
      />,
    );
    expect(submenu).not.toHaveBeenCalled();
    await user.click(screen.getByRole('menuitem', { name: 'Move' }));
    expect(
      await screen.findByRole('menuitem', { name: 'Destination' }),
    ).toBeInTheDocument();
    expect(submenu).toHaveBeenCalled();
  });

  describe('items', () => {
    // A closed menu sits in every row of a long list (a chat row's "Move to
    // project" submenu lists every project), so it must build nothing.
    it('calls an items function only while the menu shows', async () => {
      const items = vi.fn(() => [
        [{ type: 'item' as const, label: 'Pin', onClick: vi.fn() }],
      ]);
      const { user } = render(
        <DropdownMenu trigger={<button>Open Menu</button>} items={items} />,
      );
      expect(items).not.toHaveBeenCalled();
      expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Open Menu' }));
      expect(screen.getByRole('menuitem', { name: 'Pin' })).toBeInTheDocument();
      expect(items).toHaveBeenCalled();
    });
  });

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

describe('DropdownMenu search', () => {
  const groups = () => [
    [
      { type: 'label' as const, content: 'Skills' },
      {
        type: 'checkbox' as const,
        label: 'Write a PDF',
        description: 'Builds PDF documents',
        checked: false,
        onCheckedChange: vi.fn(),
      },
    ],
    [
      { type: 'label' as const, content: 'Knowledge' },
      {
        type: 'checkbox' as const,
        label: 'Search the knowledge base',
        description: 'Always on for every agent',
        checked: true,
        locked: true,
        onCheckedChange: vi.fn(),
      },
      {
        type: 'checkbox' as const,
        label: 'Add and edit knowledge entries',
        keywords: 'facts',
        checked: false,
        onCheckedChange: vi.fn(),
      },
    ],
  ];
  const search = {
    label: 'Search equipment',
    placeholder: 'Search…',
    emptyText: 'Nothing matches',
  };

  it('opens with the caret in the field and narrows rows as you type', async () => {
    const { user } = render(
      <DropdownMenu
        trigger={<button>Equipment</button>}
        items={groups}
        search={search}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Equipment' }));
    const field = screen.getByRole('searchbox', { name: 'Search equipment' });
    expect(field).toHaveFocus();

    await user.type(field, 'knowledge');
    expect(field).toHaveFocus();
    expect(screen.queryByText('Write a PDF')).not.toBeInTheDocument();
    expect(screen.queryByText('Skills')).not.toBeInTheDocument();
    expect(screen.getByText('Knowledge')).toBeInTheDocument();
    expect(
      screen.getByRole('menuitemcheckbox', {
        name: /Add and edit knowledge entries/,
      }),
    ).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, 'facts');
    expect(
      screen.getAllByRole('menuitemcheckbox').map((row) => row.textContent),
    ).toEqual(['Add and edit knowledge entries']);

    await user.clear(field);
    await user.type(field, 'zebra');
    expect(screen.getByRole('status')).toHaveTextContent('Nothing matches');
    expect(screen.queryByRole('menuitemcheckbox')).not.toBeInTheDocument();
  });

  it('moves into the rows with Arrow Down and starts over when reopened', async () => {
    const { user } = render(
      <DropdownMenu
        trigger={<button>Equipment</button>}
        items={groups}
        search={search}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Equipment' }));
    await user.type(screen.getByRole('searchbox'), 'pdf');
    await user.keyboard('{ArrowDown}');
    expect(
      screen.getByRole('menuitemcheckbox', { name: /Write a PDF/ }),
    ).toHaveFocus();

    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Equipment' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getAllByRole('menuitemcheckbox')).toHaveLength(3);
  });

  it('shows a locked row as on and unavailable to switch', async () => {
    const onCheckedChange = vi.fn();
    const { user } = render(
      <DropdownMenu
        open
        trigger={<button>Equipment</button>}
        items={[
          [
            {
              type: 'checkbox',
              label: 'Search the knowledge base',
              checked: false,
              locked: true,
              onCheckedChange,
            },
          ],
        ]}
      />,
    );
    const row = screen.getByRole('menuitemcheckbox', {
      name: /Search the knowledge base/,
    });
    expect(row).toHaveAttribute('aria-checked', 'true');
    expect(row).toHaveAttribute('aria-disabled', 'true');
    await user.click(row);
    expect(onCheckedChange).not.toHaveBeenCalled();
    await act(async () => {
      await checkAccessibility(screen.getByRole('menu'));
    });
  });
});
