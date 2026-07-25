import { describe, expect, it, vi } from 'vitest';

import { render, screen, within } from '@/tests/utils/render';

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
  const result = render(
    <SearchableSelect
      value={null}
      onValueChange={onValueChange}
      options={options}
      trigger={<button type="button">Open select</button>}
      searchPlaceholder="Search…"
      emptyText="No results"
      aria-label="Test listbox"
      {...overrides}
    />,
  );
  return { ...result, onValueChange };
}

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

    it('renders option descriptions clamped to two lines', async () => {
      const { user } = renderSelect();
      await user.click(screen.getByText('Open select'));
      const description = screen.getByText('A red fruit');
      expect(description).toBeInTheDocument();
      expect(description.className).toContain('line-clamp-2');
      expect(screen.getByText('A yellow fruit')).toBeInTheDocument();
    });

    it('shows check icon on selected option', async () => {
      const { user } = renderSelect({ value: 'apple' });
      await user.click(screen.getByText('Open select'));
      const appleOption = screen.getByRole('option', { name: /Apple/i });
      expect(appleOption.getAttribute('aria-selected')).toBe('true');
    });

    it('shows radio indicator when showRadio is enabled', async () => {
      const { user } = renderSelect({ value: 'apple', showRadio: true });
      await user.click(screen.getByText('Open select'));
      const appleOption = screen.getByRole('option', { name: /Apple/i });
      expect(appleOption.getAttribute('aria-selected')).toBe('true');
      const radioIndicators = appleOption.querySelectorAll(
        'span[aria-hidden="true"]',
      );
      expect(radioIndicators.length).toBeGreaterThan(0);
    });

    it('renders option action when provided', async () => {
      const { user } = renderSelect({
        optionAction: (option) => (
          <button type="button" data-testid={`action-${option.value}`}>
            Config
          </button>
        ),
      });
      await user.click(screen.getByText('Open select'));
      expect(screen.getByTestId('action-apple')).toBeInTheDocument();
      expect(screen.getByTestId('action-banana')).toBeInTheDocument();
    });

    it('renders empty state when no matches', async () => {
      const { user } = renderSelect();
      await user.click(screen.getByText('Open select'));
      const input = screen.getByRole('combobox');
      await user.type(input, 'zzzzz');
      expect(screen.getByText('No results')).toBeInTheDocument();
    });

    it('uses text-base on the search input so mobile browsers do not zoom on focus', async () => {
      const { user } = renderSelect();
      await user.click(screen.getByText('Open select'));
      const input = screen.getByRole('combobox');
      // iOS Safari zooms focused inputs under 16px; text-base is 1rem (16px).
      expect(input.className).toContain('text-base');
    });

    it('renders footer when provided', async () => {
      const { user } = renderSelect({
        footer: <button type="button">Add item</button>,
      });
      await user.click(screen.getByText('Open select'));
      expect(screen.getByText('Add item')).toBeInTheDocument();
    });

    it('renders a title above the search field when provided', async () => {
      const { user } = renderSelect({ title: 'Switch fruit' });
      await user.click(screen.getByText('Open select'));
      expect(screen.getByText('Switch fruit')).toBeInTheDocument();
    });

    it('marks the selected option with a leading accent in switcher variant', async () => {
      const { user } = renderSelect({
        value: 'apple',
        variant: 'switcher',
        title: 'Switch fruit',
      });
      await user.click(screen.getByText('Open select'));
      const appleOption = screen.getByRole('option', { name: /Apple/i });
      expect(appleOption.getAttribute('aria-selected')).toBe('true');
      expect(appleOption.className).toContain('bg-muted/60');
      expect(appleOption.querySelector('span.bg-blue-600')).toBeInTheDocument();
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

  describe('section headers during search', () => {
    // Mirrors assignee pickers: "Team" contains "a" so a naive label filter
    // would keep an empty Team header when only a person matches.
    const sectionedOptions: SearchableSelectOption[] = [
      {
        value: '__people_header__',
        label: 'People',
        isSectionHeader: true,
      },
      { value: 'user:israel', label: 'Israel Iyanda' },
      // No "a"/"i" so person-only and both-type queries stay precise.
      { value: 'user:bob', label: 'Bob' },
      {
        value: '__team_header__',
        label: 'Team',
        isSectionHeader: true,
      },
      { value: 'team:eng', label: 'Engineering' },
      // No "a"/"i" — "Team" itself contains "a" and must not keep an empty section.
      { value: 'team:support', label: 'Support' },
    ];

    function renderSectioned() {
      return renderSelect({ options: sectionedOptions });
    }

    it('keeps People header and drops empty Team when only a person matches', async () => {
      const { user } = renderSectioned();
      await user.click(screen.getByText('Open select'));
      await user.type(screen.getByRole('combobox'), 'a');
      // "Team".includes("a") must NOT keep an empty Team header.
      expect(screen.getByText('People')).toBeInTheDocument();
      expect(screen.queryByText('Team')).not.toBeInTheDocument();
      const opts = screen.getAllByRole('option');
      expect(opts).toHaveLength(1);
      expect(opts[0]).toHaveTextContent('Israel Iyanda');
    });

    it('keeps Team header and drops People when only a team matches', async () => {
      const { user } = renderSectioned();
      await user.click(screen.getByText('Open select'));
      await user.type(screen.getByRole('combobox'), 'eng');
      expect(screen.queryByText('People')).not.toBeInTheDocument();
      expect(screen.getByText('Team')).toBeInTheDocument();
      const opts = screen.getAllByRole('option');
      expect(opts).toHaveLength(1);
      expect(opts[0]).toHaveTextContent('Engineering');
    });

    it('keeps both headers when people and teams match', async () => {
      const { user } = renderSectioned();
      await user.click(screen.getByText('Open select'));
      // "i" matches Israel + Engineering; neither header label contains "i".
      await user.type(screen.getByRole('combobox'), 'i');
      expect(screen.getByText('People')).toBeInTheDocument();
      expect(screen.getByText('Team')).toBeInTheDocument();
      const opts = screen.getAllByRole('option');
      expect(opts).toHaveLength(2);
      expect(opts[0]).toHaveTextContent('Israel Iyanda');
      expect(opts[1]).toHaveTextContent('Engineering');
    });

    it('shows empty state when no section has matches', async () => {
      const { user } = renderSectioned();
      await user.click(screen.getByText('Open select'));
      await user.type(screen.getByRole('combobox'), 'zzzzz');
      expect(screen.queryByText('People')).not.toBeInTheDocument();
      expect(screen.queryByText('Team')).not.toBeInTheDocument();
      expect(screen.getByText('No results')).toBeInTheDocument();
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
