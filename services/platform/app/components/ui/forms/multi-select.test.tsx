import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { MultiSelect, type MultiSelectOption } from './multi-select';

const options: MultiSelectOption[] = [
  { value: 'apple', label: 'Apple', description: 'A red fruit' },
  { value: 'banana', label: 'Banana', description: 'A yellow fruit' },
  { value: 'cherry', label: 'Cherry' },
  { value: 'disabled-opt', label: 'Disabled', disabled: true },
];

function renderSelect(
  overrides: Partial<React.ComponentProps<typeof MultiSelect>> = {},
) {
  const onValueChange = vi.fn();
  const result = render(
    <MultiSelect
      value={[]}
      onValueChange={onValueChange}
      options={options}
      trigger={<button type="button">Open select</button>}
      searchPlaceholder="Search"
      emptyText="No results"
      aria-label="Test listbox"
      {...overrides}
    />,
  );
  return { ...result, onValueChange };
}

describe('MultiSelect', () => {
  describe('rendering', () => {
    it('renders the trigger', () => {
      renderSelect();
      expect(screen.getByText('Open select')).toBeInTheDocument();
    });

    it('does not render the listbox when closed', () => {
      renderSelect();
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('renders all options when open', async () => {
      const { user } = renderSelect();
      await user.click(screen.getByText('Open select'));
      expect(screen.getAllByRole('option')).toHaveLength(4);
    });

    it('marks the listbox as multi-selectable', async () => {
      const { user } = renderSelect();
      await user.click(screen.getByText('Open select'));
      expect(screen.getByRole('listbox')).toHaveAttribute(
        'aria-multiselectable',
        'true',
      );
    });

    it('renders option descriptions', async () => {
      const { user } = renderSelect();
      await user.click(screen.getByText('Open select'));
      expect(screen.getByText('A red fruit')).toBeInTheDocument();
    });

    // #2571: a long catalog/workflow/skill description must not blow out the
    // popover row — clamped to two lines, with the full text one hover away
    // via `title` (an accessible affordance since `line-clamp` only affects
    // paint, never the a11y tree — the full text stays in the DOM).
    it('clamps a long option description to two lines and keeps the full text via title', async () => {
      const longDescription =
        'A '.repeat(80) +
        'very long catalog description that would otherwise blow out the row.';
      const { user } = renderSelect({
        options: [
          {
            value: 'long',
            label: 'Long option',
            description: longDescription,
          },
        ],
      });
      await user.click(screen.getByText('Open select'));

      const description = screen.getByText(longDescription);
      expect(description).toHaveClass('line-clamp-2');
      expect(description).toHaveAttribute('title', longDescription);
    });

    it('marks selected options with aria-selected', async () => {
      const { user } = renderSelect({ value: ['apple'] });
      await user.click(screen.getByText('Open select'));
      const appleOption = screen.getByRole('option', { name: /Apple/i });
      expect(appleOption.getAttribute('aria-selected')).toBe('true');
      const cherryOption = screen.getByRole('option', { name: /Cherry/i });
      expect(cherryOption.getAttribute('aria-selected')).toBe('false');
    });

    it('renders empty state when no matches', async () => {
      const { user } = renderSelect();
      await user.click(screen.getByText('Open select'));
      await user.type(screen.getByRole('combobox'), 'zzzzz');
      expect(screen.getByText('No results')).toBeInTheDocument();
    });

    it('renders footer when provided', async () => {
      const { user } = renderSelect({
        footer: <button type="button">Add item</button>,
      });
      await user.click(screen.getByText('Open select'));
      expect(screen.getByText('Add item')).toBeInTheDocument();
    });

    it('hides the search input when searchable is false', async () => {
      const { user } = renderSelect({ searchable: false });
      await user.click(screen.getByText('Open select'));
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    });
  });

  describe('default trigger', () => {
    function renderDefault(
      overrides: Partial<React.ComponentProps<typeof MultiSelect>> = {},
    ) {
      const onValueChange = vi.fn();
      const result = render(
        <MultiSelect
          value={[]}
          onValueChange={onValueChange}
          options={options}
          placeholder="Pick fruit"
          searchPlaceholder="Search"
          {...overrides}
        />,
      );
      return { ...result, onValueChange };
    }

    it('shows the placeholder when nothing selected', () => {
      renderDefault();
      expect(screen.getByText('Pick fruit')).toBeInTheDocument();
    });

    it('renders selected values as chips', () => {
      renderDefault({ value: ['apple', 'banana'] });
      expect(screen.getByText('Apple')).toBeInTheDocument();
      expect(screen.getByText('Banana')).toBeInTheDocument();
      expect(screen.queryByText('Pick fruit')).not.toBeInTheDocument();
    });

    it('removes a value when its chip remove button is clicked', async () => {
      const { user, onValueChange } = renderDefault({
        value: ['apple', 'banana'],
      });
      await user.click(screen.getByRole('button', { name: /remove apple/i }));
      expect(onValueChange).toHaveBeenCalledWith(['banana']);
    });

    it('uses removeChipLabel for the chip remove button', () => {
      renderDefault({
        value: ['apple'],
        removeChipLabel: (o) => `Unpick ${o.label}`,
      });
      expect(
        screen.getByRole('button', { name: 'Unpick Apple' }),
      ).toBeInTheDocument();
    });

    it('marks the default trigger disabled', () => {
      renderDefault({ disabled: true });
      expect(screen.getByRole('combobox')).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    });

    it('does not open on click when disabled', async () => {
      const { user } = renderDefault({ disabled: true });
      await user.click(screen.getByRole('combobox'));
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('does not emit onValueChange when disabled and toggled', async () => {
      const { user, onValueChange } = renderDefault({
        disabled: true,
        open: true,
      });
      // Even if the popover is forced open, a disabled select must not mutate
      // its value when an option is clicked.
      await user.click(screen.getByRole('option', { name: /Apple/i }));
      expect(onValueChange).not.toHaveBeenCalled();
    });
  });

  describe('interactions', () => {
    it('opens on trigger click', async () => {
      const { user } = renderSelect();
      await user.click(screen.getByText('Open select'));
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('filters options by search query', async () => {
      const { user } = renderSelect();
      await user.click(screen.getByText('Open select'));
      await user.type(screen.getByRole('combobox'), 'ban');
      const opts = screen.getAllByRole('option');
      expect(opts).toHaveLength(1);
      expect(opts[0]).toHaveTextContent('Banana');
    });

    it('adds a value when toggling an unselected option', async () => {
      const { user, onValueChange } = renderSelect({ value: ['apple'] });
      await user.click(screen.getByText('Open select'));
      await user.click(screen.getByRole('option', { name: /Banana/i }));
      expect(onValueChange).toHaveBeenCalledWith(['apple', 'banana']);
    });

    it('removes a value when toggling a selected option', async () => {
      const { user, onValueChange } = renderSelect({
        value: ['apple', 'banana'],
      });
      await user.click(screen.getByText('Open select'));
      await user.click(screen.getByRole('option', { name: /Apple/i }));
      expect(onValueChange).toHaveBeenCalledWith(['banana']);
    });

    it('keeps the popover open after toggling (multi-select)', async () => {
      const { user } = renderSelect();
      await user.click(screen.getByText('Open select'));
      await user.click(screen.getByRole('option', { name: /Apple/i }));
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('does not toggle disabled options', async () => {
      const { user, onValueChange } = renderSelect();
      await user.click(screen.getByText('Open select'));
      await user.click(screen.getByRole('option', { name: /Disabled/i }));
      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('toggles the highlighted option with Enter', async () => {
      const { user, onValueChange } = renderSelect();
      await user.click(screen.getByText('Open select'));
      const input = screen.getByRole('combobox');
      await user.type(input, '{ArrowDown}{Enter}');
      expect(onValueChange).toHaveBeenCalledWith(['banana']);
    });
  });

  describe('keyboard navigation without a search input', () => {
    it('focuses the listbox on open so it is keyboard-operable', async () => {
      const { user } = renderSelect({ searchable: false });
      await user.click(screen.getByText('Open select'));
      const listbox = screen.getByRole('listbox');
      expect(listbox).toHaveAttribute('tabindex', '0');
      expect(listbox).toHaveFocus();
    });

    it('toggles the highlighted option with ArrowDown + Enter', async () => {
      const { user, onValueChange } = renderSelect({ searchable: false });
      await user.click(screen.getByText('Open select'));
      await user.keyboard('{ArrowDown}{Enter}');
      expect(onValueChange).toHaveBeenCalledWith(['banana']);
    });

    it('toggles the first/last option with Home/End', async () => {
      const { user, onValueChange } = renderSelect({ searchable: false });
      await user.click(screen.getByText('Open select'));
      await user.keyboard('{End}{Enter}');
      // Last option (index 3) is disabled, so End lands on the last *enabled*
      // option, Cherry.
      expect(onValueChange).toHaveBeenCalledWith(['cherry']);
      onValueChange.mockClear();
      await user.keyboard('{Home}{Enter}');
      expect(onValueChange).toHaveBeenCalledWith(['apple']);
    });

    it('exposes the highlighted option via aria-activedescendant', async () => {
      const { user } = renderSelect({ searchable: false });
      await user.click(screen.getByText('Open select'));
      const listbox = screen.getByRole('listbox');
      const activeId = listbox.getAttribute('aria-activedescendant');
      expect(activeId).toBeTruthy();
      expect(screen.getByRole('option', { name: /Apple/i })).toHaveAttribute(
        'id',
        activeId,
      );
    });
  });

  // `chipsMaxHeightClassName` only applies to the DEFAULT trigger, so these
  // render without the custom `trigger` the other cases use. The scroll button
  // itself is overflow-driven and jsdom reports zero geometry, so the contract
  // under test is where the chips live, not whether the cue is showing.
  describe('capped chip row', () => {
    it('scrolls the chips inside a capped region when a cap is given', () => {
      const { container } = render(
        <MultiSelect
          value={['apple', 'banana']}
          onValueChange={vi.fn()}
          options={options}
          chipsMaxHeightClassName="max-h-40"
          aria-label="Fruits"
        />,
      );

      const capped = container.querySelector('.max-h-40');
      expect(capped).not.toBeNull();
      expect(capped).toHaveClass('overflow-y-auto');
      expect(capped).toHaveTextContent('Apple');
      expect(capped).toHaveTextContent('Banana');
    });

    it('wraps the chips on the trigger when no cap is given', () => {
      const { container } = render(
        <MultiSelect
          value={['apple', 'banana']}
          onValueChange={vi.fn()}
          options={options}
          aria-label="Fruits"
        />,
      );

      expect(container.querySelector('.overflow-y-auto')).toBeNull();
      expect(screen.getByText('Apple')).toBeInTheDocument();
    });

    it('leaves an empty selection uncapped', () => {
      const { container } = render(
        <MultiSelect
          value={[]}
          onValueChange={vi.fn()}
          options={options}
          chipsMaxHeightClassName="max-h-40"
          aria-label="Fruits"
        />,
      );

      expect(container.querySelector('.max-h-40')).toBeNull();
    });
  });
});
