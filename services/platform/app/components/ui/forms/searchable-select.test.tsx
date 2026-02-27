import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render, screen, within } from '@/test/utils/render';

import {
  SearchableSelect,
  type SearchableSelectOption,
} from './searchable-select';

const options: SearchableSelectOption[] = [
  { value: 'apple', label: 'Apple', description: 'A red fruit' },
  { value: 'banana', label: 'Banana', description: 'A yellow fruit' },
  { value: 'cherry', label: 'Cherry' },
  { value: 'disabled-opt', label: 'Disabled', disabled: true },
];

function renderSelect(
  overrides: Partial<React.ComponentProps<typeof SearchableSelect>> = {},
) {
  const onValueChange = vi.fn();
  const onOpenChange = vi.fn();
  const result = render(
    <SearchableSelect
      value={null}
      onValueChange={onValueChange}
      options={options}
      trigger={<button type="button">Open select</button>}
      searchPlaceholder="Search..."
      emptyText="No results"
      aria-label="Test listbox"
      {...overrides}
    />,
  );
  return { ...result, onValueChange, onOpenChange };
}

afterEach(cleanup);

describe('SearchableSelect', () => {
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
      const opts = screen.getAllByRole('option');
      expect(opts).toHaveLength(4);
    });

    it('renders option descriptions', async () => {
      const { user } = renderSelect();
      await user.click(screen.getByText('Open select'));
      expect(screen.getByText('A red fruit')).toBeInTheDocument();
      expect(screen.getByText('A yellow fruit')).toBeInTheDocument();
    });

    it('shows check icon on selected option', async () => {
      const { user } = renderSelect({ value: 'apple' });
      await user.click(screen.getByText('Open select'));
      const appleOption = screen.getByRole('option', { name: /Apple/i });
      expect(appleOption.getAttribute('aria-selected')).toBe('true');
    });

    it('renders empty state when no matches', async () => {
      const { user } = renderSelect();
      await user.click(screen.getByText('Open select'));
      const input = screen.getByRole('combobox');
      await user.type(input, 'zzzzz');
      expect(screen.getByText('No results')).toBeInTheDocument();
    });

    it('renders footer when provided', async () => {
      const { user } = renderSelect({
        footer: <button type="button">Add item</button>,
      });
      await user.click(screen.getByText('Open select'));
      expect(screen.getByText('Add item')).toBeInTheDocument();
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
      const input = screen.getByRole('combobox');
      await user.type(input, 'ban');
      const opts = screen.getAllByRole('option');
      expect(opts).toHaveLength(1);
      expect(opts[0]).toHaveTextContent('Banana');
    });

    it('filters by description', async () => {
      const { user } = renderSelect();
      await user.click(screen.getByText('Open select'));
      const input = screen.getByRole('combobox');
      await user.type(input, 'yellow');
      const opts = screen.getAllByRole('option');
      expect(opts).toHaveLength(1);
      expect(opts[0]).toHaveTextContent('Banana');
    });

    it('selects option on click', async () => {
      const { user, onValueChange } = renderSelect();
      await user.click(screen.getByText('Open select'));
      await user.click(screen.getByText('Cherry'));
      expect(onValueChange).toHaveBeenCalledWith('cherry');
    });

    it('does not select disabled options', async () => {
      const { user, onValueChange } = renderSelect();
      await user.click(screen.getByText('Open select'));
      await user.click(screen.getByText('Disabled'));
      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('uses custom filterFn when provided', async () => {
      const filterFn = (opt: SearchableSelectOption, query: string) =>
        opt.value.includes(query);
      const { user } = renderSelect({ filterFn });
      await user.click(screen.getByText('Open select'));
      const input = screen.getByRole('combobox');
      await user.type(input, 'cherry');
      const opts = screen.getAllByRole('option');
      expect(opts).toHaveLength(1);
      expect(opts[0]).toHaveTextContent('Cherry');
    });
  });

  describe('keyboard navigation', () => {
    it('moves highlight down with ArrowDown', async () => {
      const { user } = renderSelect();
      await user.click(screen.getByText('Open select'));
      const input = screen.getByRole('combobox');
      await user.keyboard('{ArrowDown}');
      const listbox = screen.getByRole('listbox');
      const highlighted = within(listbox).getAllByRole('option')[1];
      expect(input.getAttribute('aria-activedescendant')).toBe(highlighted.id);
    });

    it('moves highlight up with ArrowUp', async () => {
      const { user } = renderSelect();
      await user.click(screen.getByText('Open select'));
      await user.keyboard('{ArrowDown}');
      await user.keyboard('{ArrowDown}');
      await user.keyboard('{ArrowUp}');
      const input = screen.getByRole('combobox');
      const listbox = screen.getByRole('listbox');
      const highlighted = within(listbox).getAllByRole('option')[1];
      expect(input.getAttribute('aria-activedescendant')).toBe(highlighted.id);
    });

    it('wraps from last to first on ArrowDown', async () => {
      const { user } = renderSelect();
      await user.click(screen.getByText('Open select'));
      const input = screen.getByRole('combobox');
      await user.keyboard('{ArrowDown}');
      await user.keyboard('{ArrowDown}');
      await user.keyboard('{ArrowDown}');
      const listbox = screen.getByRole('listbox');
      const first = within(listbox).getAllByRole('option')[0];
      expect(input.getAttribute('aria-activedescendant')).toBe(first.id);
    });

    it('wraps from first to last enabled on ArrowUp', async () => {
      const { user } = renderSelect();
      await user.click(screen.getByText('Open select'));
      const input = screen.getByRole('combobox');
      await user.keyboard('{ArrowUp}');
      const listbox = screen.getByRole('listbox');
      const cherryOpt = within(listbox).getByRole('option', {
        name: /Cherry/i,
      });
      expect(input.getAttribute('aria-activedescendant')).toBe(cherryOpt.id);
    });

    it('selects highlighted option on Enter', async () => {
      const { user, onValueChange } = renderSelect();
      await user.click(screen.getByText('Open select'));
      await user.keyboard('{ArrowDown}');
      await user.keyboard('{Enter}');
      expect(onValueChange).toHaveBeenCalledWith('banana');
    });

    it('skips disabled options on ArrowDown', async () => {
      const { user } = renderSelect();
      await user.click(screen.getByText('Open select'));
      const input = screen.getByRole('combobox');
      await user.keyboard('{ArrowDown}');
      await user.keyboard('{ArrowDown}');
      await user.keyboard('{ArrowDown}');
      const listbox = screen.getByRole('listbox');
      const appleOpt = within(listbox).getByRole('option', { name: /Apple/i });
      expect(input.getAttribute('aria-activedescendant')).toBe(appleOpt.id);
    });

    it('moves to first option on Home', async () => {
      const { user } = renderSelect();
      await user.click(screen.getByText('Open select'));
      await user.keyboard('{ArrowDown}');
      await user.keyboard('{ArrowDown}');
      await user.keyboard('{Home}');
      const input = screen.getByRole('combobox');
      const listbox = screen.getByRole('listbox');
      const first = within(listbox).getAllByRole('option')[0];
      expect(input.getAttribute('aria-activedescendant')).toBe(first.id);
    });

    it('moves to last enabled option on End', async () => {
      const { user } = renderSelect();
      await user.click(screen.getByText('Open select'));
      await user.keyboard('{End}');
      const input = screen.getByRole('combobox');
      const listbox = screen.getByRole('listbox');
      const cherryOpt = within(listbox).getByRole('option', {
        name: /Cherry/i,
      });
      expect(input.getAttribute('aria-activedescendant')).toBe(cherryOpt.id);
    });

    it('resets highlight when search changes', async () => {
      const { user } = renderSelect();
      await user.click(screen.getByText('Open select'));
      await user.keyboard('{ArrowDown}');
      await user.keyboard('{ArrowDown}');
      const input = screen.getByRole('combobox');
      await user.type(input, 'a');
      const listbox = screen.getByRole('listbox');
      const first = within(listbox).getAllByRole('option')[0];
      expect(input.getAttribute('aria-activedescendant')).toBe(first.id);
    });

    it('does not select disabled option on Enter', async () => {
      const disabledOnly: SearchableSelectOption[] = [
        { value: 'disabled', label: 'Disabled', disabled: true },
      ];
      const { user, onValueChange } = renderSelect({ options: disabledOnly });
      await user.click(screen.getByText('Open select'));
      await user.keyboard('{Enter}');
      expect(onValueChange).not.toHaveBeenCalled();
    });
  });

  describe('accessibility', () => {
    it('search input has role combobox', async () => {
      const { user } = renderSelect();
      await user.click(screen.getByText('Open select'));
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('options container has role listbox', async () => {
      const { user } = renderSelect();
      await user.click(screen.getByText('Open select'));
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('listbox has aria-label', async () => {
      const { user } = renderSelect();
      await user.click(screen.getByText('Open select'));
      expect(screen.getByRole('listbox')).toHaveAttribute(
        'aria-label',
        'Test listbox',
      );
    });

    it('options have role option', async () => {
      const { user } = renderSelect();
      await user.click(screen.getByText('Open select'));
      expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    });

    it('selected option has aria-selected true', async () => {
      const { user } = renderSelect({ value: 'banana' });
      await user.click(screen.getByText('Open select'));
      const opt = screen.getByRole('option', { name: /Banana/i });
      expect(opt.getAttribute('aria-selected')).toBe('true');
    });

    it('non-selected option has aria-selected false', async () => {
      const { user } = renderSelect({ value: 'banana' });
      await user.click(screen.getByText('Open select'));
      const opt = screen.getByRole('option', { name: /Cherry/i });
      expect(opt.getAttribute('aria-selected')).toBe('false');
    });

    it('disabled option has aria-disabled', async () => {
      const { user } = renderSelect();
      await user.click(screen.getByText('Open select'));
      const opt = screen.getByRole('option', { name: /Disabled/i });
      expect(opt).toHaveAttribute('aria-disabled', 'true');
    });

    it('combobox has aria-activedescendant', async () => {
      const { user } = renderSelect();
      await user.click(screen.getByText('Open select'));
      const input = screen.getByRole('combobox');
      expect(input).toHaveAttribute('aria-activedescendant');
    });

    it('combobox has aria-controls pointing to listbox', async () => {
      const { user } = renderSelect();
      await user.click(screen.getByText('Open select'));
      const input = screen.getByRole('combobox');
      const listbox = screen.getByRole('listbox');
      expect(input.getAttribute('aria-controls')).toBe(listbox.id);
    });
  });
});
