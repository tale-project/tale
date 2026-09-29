// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { pickFilterOption } from '@tale/ui/testing/filters';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import {
  FilterPanel,
  isFilterAffordanceDisabled,
  type FilterConfig,
} from './filter-panel';

const tagFilter = (overrides: Partial<FilterConfig> = {}): FilterConfig => ({
  key: 'tags',
  title: 'Tags',
  options: [
    { value: 'messaging', label: 'Messaging' },
    { value: 'code', label: 'Code' },
  ],
  selectedValues: [],
  onChange: vi.fn(),
  multiSelect: true,
  ...overrides,
});

describe('FilterPanel', () => {
  it('renders nothing when there is no facet to offer', () => {
    render(<FilterPanel filters={[]} onClearAll={vi.fn()} />);
    expect(
      screen.queryByRole('button', { name: 'Filter' }),
    ).not.toBeInTheDocument();
  });

  it('names the panel dialog after its visible heading', async () => {
    const { user } = render(
      <FilterPanel filters={[tagFilter()]} onClearAll={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    expect(
      await screen.findByRole('dialog', { name: 'Filters' }),
    ).toBeInTheDocument();
  });

  it('reports the complete next selection when an option is ticked', async () => {
    const onChange = vi.fn();
    const { user } = render(
      <FilterPanel
        filters={[tagFilter({ selectedValues: ['code'], onChange })]}
        onClearAll={vi.fn()}
      />,
    );
    await pickFilterOption(user, 'Tags', 'Messaging');
    expect(onChange).toHaveBeenCalledWith(['code', 'messaging']);
  });

  it('heads each run of grouped options and still reports a flat selection', async () => {
    const onChange = vi.fn();
    const { user } = render(
      <FilterPanel
        filters={[
          tagFilter({
            key: 'assignee',
            title: 'Assignee',
            options: [
              { value: 'me', label: 'Assigned to me' },
              { value: 'u1', label: 'Dana K.', group: 'People' },
              { value: 't1', label: 'Billing', group: 'Teams' },
            ],
            onChange,
          }),
        ]}
        onClearAll={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    await user.click(await screen.findByRole('button', { name: 'Assignee' }));

    expect(screen.getByText('People')).toBeInTheDocument();
    expect(screen.getByText('Teams')).toBeInTheDocument();
    // The ungrouped head keeps no heading of its own.
    expect(
      screen.getByRole('checkbox', { name: 'Assigned to me' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Billing' }));
    expect(onChange).toHaveBeenCalledWith(['t1']);
  });

  it('labels a grouped radio facet by its group, not the facet title', async () => {
    const { user } = render(
      <FilterPanel
        filters={[
          tagFilter({
            key: 'owner',
            title: 'Owner',
            multiSelect: false,
            options: [
              { value: 'u1', label: 'Dana K.', group: 'People' },
              { value: 't1', label: 'Billing', group: 'Teams' },
            ],
          }),
        ]}
        onClearAll={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    await user.click(await screen.findByRole('button', { name: 'Owner' }));

    expect(
      screen.getByRole('radiogroup', { name: 'People' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radiogroup', { name: 'Teams' }),
    ).toBeInTheDocument();
  });

  it('draws the selected radio mark in the accent, not a fixed blue', async () => {
    const { user } = render(
      <FilterPanel
        filters={[
          tagFilter({
            key: 'owner',
            title: 'Owner',
            multiSelect: false,
            selectedValues: ['code'],
          }),
        ]}
        onClearAll={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    await user.click(await screen.findByRole('button', { name: 'Owner' }));

    const mark = screen
      .getByRole('radio', { checked: true })
      .querySelector('[aria-hidden="true"]');
    expect(mark).toHaveClass('border-primary', 'text-primary');
    expect(mark?.className).not.toMatch(/-blue-/);
  });

  it('uses one divider under the header and divide-y between facets', async () => {
    const { user } = render(
      <FilterPanel
        filters={[
          tagFilter({ key: 'assignee', title: 'Assignee' }),
          tagFilter({ key: 'priority', title: 'Priority' }),
        ]}
        onClearAll={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Filter' }));

    const header = screen.getByText('Filters').closest('div');
    expect(header).toHaveClass('border-b');

    const list = header?.nextElementSibling;
    expect(list).toHaveClass('divide-y');
    expect(list?.children[0]).not.toHaveClass('border-t');
  });

  it('keeps facet groups collapsed until asked', async () => {
    const { user } = render(
      <FilterPanel filters={[tagFilter()]} onClearAll={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    // The group is listed, but its options stay out of the way — the panel has
    // to survive a facet with fifty tags in it.
    expect(await screen.findByRole('button', { name: 'Tags' })).toBeVisible();
    expect(
      screen.queryByRole('checkbox', { name: 'Messaging' }),
    ).not.toBeInTheDocument();
  });

  it('offers Clear all only while something is selected, then closes', async () => {
    const onClearAll = vi.fn();
    const { user } = render(
      <FilterPanel
        filters={[tagFilter({ selectedValues: ['code'] })]}
        onClearAll={onClearAll}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    await user.click(await screen.findByRole('button', { name: 'Clear all' }));
    expect(onClearAll).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole('button', { name: 'Clear all' }),
    ).not.toBeInTheDocument();
  });

  it('cannot be opened when disabled', async () => {
    const { user } = render(
      <FilterPanel filters={[tagFilter()]} onClearAll={vi.fn()} disabled />,
    );
    const button = screen.getByRole('button', { name: 'Filter' });
    expect(button).toBeDisabled();
    await user.click(button);
    // A disabled button on the Popover trigger is not enough — the wrapper
    // still toggles it — so the panel must be left out of the tree entirely.
    expect(
      screen.queryByRole('button', { name: 'Tags' }),
    ).not.toBeInTheDocument();
  });

  it('stays open when disabled mid-use, then gives way to the disabled button once closed', async () => {
    const { user, rerender } = render(
      <FilterPanel filters={[tagFilter()]} onClearAll={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    await user.click(await screen.findByRole('button', { name: 'Tags' }));

    // The caller disables the panel under the reader — the last facet was
    // unticked over an empty list, or the list went back to its first page.
    rerender(
      <FilterPanel filters={[tagFilter()]} onClearAll={vi.fn()} disabled />,
    );
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'Messaging' }),
    ).toBeInTheDocument();

    // The reader closes it: focus comes back to the button, which says it is
    // unavailable, and it leaves the tab order once the reader moves on.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Filter' });
    await waitFor(() => expect(button).toHaveFocus());
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await user.tab();
    expect(button).toBeDisabled();

    // A row lands: the panel is offered again, but nobody asked to open it.
    rerender(<FilterPanel filters={[tagFilter()]} onClearAll={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Filter' })).toBeEnabled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the focus on the button when Clear all leaves nothing to narrow', async () => {
    // An empty list: the selection is all that keeps the filter usable.
    function EmptyList() {
      const [selected, setSelected] = useState(['code']);
      return (
        <FilterPanel
          filters={[
            tagFilter({ selectedValues: selected, onChange: setSelected }),
          ]}
          onClearAll={() => setSelected([])}
          disabled={isFilterAffordanceDisabled({
            itemCount: 0,
            hasActiveFilters: selected.length > 0,
          })}
        />
      );
    }
    const { user } = render(<EmptyList />);
    const button = screen.getByRole('button', { name: 'Filter' });
    await user.click(button);
    await user.click(await screen.findByRole('button', { name: 'Clear all' }));

    // The same button takes the focus back: a disabled one would drop it to
    // the page, so it stays focusable and reads as unavailable instead.
    await waitFor(() => expect(button).toHaveFocus());
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.tab();
    expect(button).toBeDisabled();
  });

  it('keeps a focused button focusable when the list empties under it', async () => {
    const { user, rerender } = render(
      <FilterPanel filters={[tagFilter()]} onClearAll={vi.fn()} />,
    );
    await user.tab();
    const button = screen.getByRole('button', { name: 'Filter' });
    expect(button).toHaveFocus();

    rerender(
      <FilterPanel filters={[tagFilter()]} onClearAll={vi.fn()} disabled />,
    );
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    await user.click(button);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.tab();
    expect(button).toBeDisabled();
  });

  it('closes when its facets go away while open', async () => {
    const { user, rerender } = render(
      <FilterPanel filters={[tagFilter()]} onClearAll={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    expect(
      await screen.findByRole('dialog', { name: 'Filters' }),
    ).toBeInTheDocument();

    rerender(<FilterPanel filters={[]} onClearAll={vi.fn()} />);
    rerender(<FilterPanel filters={[tagFilter()]} onClearAll={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // #3746: a single-choice facet is one radio group — one Tab stop, the arrow
  // keys move the choice — and the panel opens with the keyboard inside it.
  describe('a single-choice facet from the keyboard', () => {
    const PRIORITIES = [
      { value: 'p0', label: 'Urgent' },
      { value: 'p1', label: 'High' },
      { value: 'p2', label: 'Medium' },
    ];

    /** A toolbar that keeps what the reader picks, beside a second facet. */
    function Toolbar({
      initial = [],
      defaultValues,
      onChange = vi.fn(),
    }: {
      initial?: string[];
      defaultValues?: string[];
      onChange?: (values: string[]) => void;
    }) {
      const [priority, setPriority] = useState(initial);
      return (
        <FilterPanel
          filters={[
            {
              key: 'priority',
              title: 'Priority',
              options: PRIORITIES,
              selectedValues: priority,
              ...(defaultValues === undefined ? {} : { defaultValues }),
              onChange: (values) => {
                onChange(values);
                setPriority(values);
              },
            },
            tagFilter(),
          ]}
          onClearAll={() => setPriority(defaultValues ?? [])}
        />
      );
    }

    /** Press an arrow key and wait for the focus to land on `next`. Held
     * until then, as a person holds a key; or, `quick`, released at once, the
     * way a key comes up before the focus moves on a page still busy with the
     * last choice. The option the focus lands on is chosen either way. */
    async function pressArrow(
      user: ReturnType<typeof render>['user'],
      key: 'ArrowDown' | 'ArrowUp',
      next: string,
      { quick = false }: { quick?: boolean } = {},
    ) {
      await user.keyboard(quick ? `{${key}}` : `{${key}>}`);
      await waitFor(() =>
        expect(screen.getByRole('radio', { name: next })).toHaveFocus(),
      );
      if (!quick) await user.keyboard(`{/${key}}`);
    }

    /** Open the panel and the Priority facet, leaving the focus on its
     * header, the control before the options. */
    async function openPriority(user: ReturnType<typeof render>['user']) {
      await user.click(screen.getByRole('button', { name: 'Filter' }));
      const header = await screen.findByRole('button', {
        name: (name) => name.startsWith('Priority'),
      });
      await user.click(header);
      expect(header).toHaveFocus();
    }

    it('opens with the focus on its first facet, not on Clear all', async () => {
      const { user } = render(<Toolbar initial={['p1']} />);
      await user.tab();
      await user.keyboard('{Enter}');

      expect(
        await screen.findByRole('dialog', { name: 'Filters' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Clear all' }),
      ).toBeInTheDocument();
      const header = screen.getByRole('button', {
        name: (name) => name.startsWith('Priority'),
      });
      await waitFor(() => expect(header).toHaveFocus());

      // From there the keyboard alone reaches the options.
      await user.keyboard('{Enter}');
      await user.tab();
      expect(screen.getByRole('radio', { name: 'High' })).toHaveFocus();
    });

    it('is one Tab stop whose arrow keys move the choice', async () => {
      const onChange = vi.fn();
      const { user } = render(<Toolbar onChange={onChange} />);
      await openPriority(user);

      // Nothing chosen yet: Tab lands on the first option and chooses nothing.
      await user.tab();
      expect(screen.getByRole('radio', { name: 'Urgent' })).toHaveFocus();
      expect(onChange).not.toHaveBeenCalled();

      await pressArrow(user, 'ArrowDown', 'High');
      expect(onChange).toHaveBeenLastCalledWith(['p1']);
      expect(screen.getByRole('radio', { name: 'High' })).toBeChecked();
      await pressArrow(user, 'ArrowDown', 'Medium');
      await pressArrow(user, 'ArrowDown', 'Urgent');
      await pressArrow(user, 'ArrowUp', 'Medium');
      expect(onChange).toHaveBeenLastCalledWith(['p2']);
      // One choice per key, never a second one for the same option.
      expect(onChange.mock.calls).toEqual([
        [['p1']],
        [['p2']],
        [['p0']],
        [['p2']],
      ]);
      expect(
        screen.getAllByRole('radio').map((radio) => radio.tabIndex),
      ).toEqual([-1, -1, 0]);

      // Tab leaves the group for the next facet, Shift+Tab comes back to the
      // chosen option.
      await user.tab();
      expect(
        screen.getByRole('button', { name: (name) => name.startsWith('Tags') }),
      ).toHaveFocus();
      await user.tab({ shift: true });
      expect(screen.getByRole('radio', { name: 'Medium' })).toHaveFocus();
      expect(screen.getByRole('radio', { name: 'Medium' })).toBeChecked();
    });

    it('chooses the option the focus lands on even when the key came up first', async () => {
      const onChange = vi.fn();
      const { user } = render(<Toolbar initial={['p1']} onChange={onChange} />);
      await openPriority(user);
      await user.tab();
      expect(screen.getByRole('radio', { name: 'High' })).toHaveFocus();

      for (const next of ['Medium', 'Urgent', 'High']) {
        await pressArrow(user, 'ArrowDown', next, { quick: true });
        await waitFor(() =>
          expect(screen.getByRole('radio', { name: next })).toBeChecked(),
        );
      }
      expect(onChange.mock.calls).toEqual([[['p2']], [['p0']], [['p1']]]);
    });

    it('clears an optional facet with Space on the chosen option, as a click does', async () => {
      const onChange = vi.fn();
      const { user } = render(<Toolbar initial={['p1']} onChange={onChange} />);
      await openPriority(user);
      await user.tab();
      const high = screen.getByRole('radio', { name: 'High' });
      expect(high).toHaveFocus();

      await user.keyboard(' ');
      expect(onChange).toHaveBeenLastCalledWith([]);
      expect(high).not.toBeChecked();
      expect(high).toHaveFocus();

      await user.keyboard(' ');
      expect(onChange).toHaveBeenLastCalledWith(['p1']);
      expect(high).toBeChecked();

      await user.click(high);
      expect(onChange).toHaveBeenLastCalledWith([]);
      await user.click(screen.getByRole('radio', { name: 'Urgent' }));
      expect(onChange).toHaveBeenLastCalledWith(['p0']);
    });

    it('sets a facet that always holds a value back to its resting value', async () => {
      const onChange = vi.fn();
      const { user } = render(
        <Toolbar initial={['p0']} defaultValues={['p2']} onChange={onChange} />,
      );
      await openPriority(user);
      await user.tab();
      expect(screen.getByRole('radio', { name: 'Urgent' })).toHaveFocus();

      await user.keyboard(' ');
      expect(onChange).toHaveBeenLastCalledWith(['p2']);
      expect(screen.getByRole('radio', { name: 'Medium' })).toBeChecked();
    });
  });

  describe('isFilterAffordanceDisabled', () => {
    it('disables an empty, unfiltered set', () => {
      expect(
        isFilterAffordanceDisabled({ itemCount: 0, hasActiveFilters: false }),
      ).toBe(true);
    });

    it('stays enabled while the set is still loading', () => {
      expect(
        isFilterAffordanceDisabled({
          isLoading: true,
          itemCount: 0,
          hasActiveFilters: false,
        }),
      ).toBe(false);
    });

    it('stays enabled when the read failed, since the set is unknown', () => {
      expect(
        isFilterAffordanceDisabled({
          isError: true,
          itemCount: 0,
          hasActiveFilters: false,
        }),
      ).toBe(false);
    });

    it('stays enabled on a filtered-to-empty result so it can be undone', () => {
      expect(
        isFilterAffordanceDisabled({ itemCount: 0, hasActiveFilters: true }),
      ).toBe(false);
    });

    it('stays enabled on an empty set when a filter can widen it', () => {
      expect(
        isFilterAffordanceDisabled({
          itemCount: 0,
          hasActiveFilters: false,
          filters: [tagFilter({ widensResultSet: true })],
        }),
      ).toBe(false);
    });
  });

  describe('accessibility', () => {
    it('passes axe audit with an expanded facet group', async () => {
      const { container, user } = render(
        <FilterPanel
          filters={[tagFilter({ selectedValues: ['code'] })]}
          onClearAll={vi.fn()}
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Filter' }));
      await user.click(
        await screen.findByRole('button', {
          name: (name) => name.startsWith('Tags'),
        }),
      );
      await checkAccessibility(container);
    });
  });
});
