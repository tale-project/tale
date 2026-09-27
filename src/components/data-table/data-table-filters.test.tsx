import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import type { FilterConfig } from './data-table-filters';
import { DataTableFilters } from './data-table-filters';

function createFilter(overrides?: Partial<FilterConfig>): FilterConfig {
  return {
    key: 'status',
    title: 'Status',
    options: [
      { value: 'active', label: 'Active' },
      { value: 'inactive', label: 'Inactive' },
      { value: 'pending', label: 'Pending' },
    ],
    selectedValues: [],
    onChange: vi.fn(),
    ...overrides,
  };
}

async function openFilterPanel(
  user: ReturnType<typeof import('@testing-library/user-event').default.setup>,
) {
  const filterButton = screen.getByRole('button', { name: /filter/i });
  await user.click(filterButton);
}

async function expandSection(
  user: ReturnType<typeof import('@testing-library/user-event').default.setup>,
  title: string,
) {
  const sectionButton = screen.getByRole('button', {
    name: new RegExp(title, 'i'),
  });
  await user.click(sectionButton);
}

describe('DataTableFilters', () => {
  describe('single-select (radio) filters', () => {
    it('selects option when clicking the row button', async () => {
      const onChange = vi.fn();
      const filter = createFilter({ onChange });

      const { user } = render(<DataTableFilters filters={[filter]} />);

      await openFilterPanel(user);
      await expandSection(user, 'Status');

      const activeButton = screen.getByRole('radio', { name: 'Active' });
      await user.click(activeButton);

      expect(onChange).toHaveBeenCalledWith(['active']);
    });

    it('deselects option when clicking a selected row', async () => {
      const onChange = vi.fn();
      const filter = createFilter({
        selectedValues: ['active'],
        onChange,
      });

      const { user } = render(<DataTableFilters filters={[filter]} />);

      await openFilterPanel(user);
      await expandSection(user, 'Status');

      const activeButton = screen.getByRole('radio', { name: 'Active' });
      await user.click(activeButton);

      expect(onChange).toHaveBeenCalledWith([]);
    });

    it('shows selected state styling on the row', async () => {
      const filter = createFilter({ selectedValues: ['active'] });

      const { user } = render(<DataTableFilters filters={[filter]} />);

      await openFilterPanel(user);
      await expandSection(user, 'Status');

      const activeButton = screen.getByRole('radio', { name: 'Active' });
      expect(activeButton).toHaveClass('bg-muted');

      const inactiveButton = screen.getByRole('radio', {
        name: 'Inactive',
      });
      expect(inactiveButton).not.toHaveClass('bg-muted');
    });

    it('sets aria-checked on selected radio', async () => {
      const filter = createFilter({ selectedValues: ['active'] });

      const { user } = render(<DataTableFilters filters={[filter]} />);

      await openFilterPanel(user);
      await expandSection(user, 'Status');

      const activeButton = screen.getByRole('radio', { name: 'Active' });
      expect(activeButton).toHaveAttribute('aria-checked', 'true');

      const inactiveButton = screen.getByRole('radio', {
        name: 'Inactive',
      });
      expect(inactiveButton).toHaveAttribute('aria-checked', 'false');
    });
  });

  describe('mandatory filters (defaultValues)', () => {
    // A filter that always carries a value (a metrics period, a status
    // bucket) is at REST while it shows its default — the trigger must not
    // signal an active filter for a state the user cannot clear away.
    it('shows no active indicator while the selection equals the default', () => {
      const filter = createFilter({
        selectedValues: ['active'],
        defaultValues: ['active'],
      });

      const { container } = render(<DataTableFilters filters={[filter]} />);

      expect(container.querySelector('.bg-blue-500')).toBeNull();
    });

    it('shows the active indicator once the selection leaves the default', () => {
      const filter = createFilter({
        selectedValues: ['inactive'],
        defaultValues: ['active'],
      });

      const { container } = render(<DataTableFilters filters={[filter]} />);

      expect(container.querySelector('.bg-blue-500')).not.toBeNull();
    });

    it('clear-all restores the default instead of emptying the filter', async () => {
      const onChange = vi.fn();
      const filter = createFilter({
        selectedValues: ['inactive'],
        defaultValues: ['active'],
        onChange,
      });

      const { user } = render(<DataTableFilters filters={[filter]} />);

      await openFilterPanel(user);
      await user.click(screen.getByRole('button', { name: 'Clear all' }));

      expect(onChange).toHaveBeenCalledWith(['active']);
    });

    it('deselecting the chosen option falls back to the default', async () => {
      const onChange = vi.fn();
      const filter = createFilter({
        selectedValues: ['inactive'],
        defaultValues: ['active'],
        onChange,
      });

      const { user } = render(<DataTableFilters filters={[filter]} />);

      await openFilterPanel(user);
      await expandSection(user, 'Status');
      await user.click(screen.getByRole('radio', { name: 'Inactive' }));

      expect(onChange).toHaveBeenCalledWith(['active']);
    });
  });

  describe('multi-select (checkbox) filters', () => {
    it('selects option when clicking the row area', async () => {
      const onChange = vi.fn();
      const filter = createFilter({ multiSelect: true, onChange });

      const { user } = render(<DataTableFilters filters={[filter]} />);

      await openFilterPanel(user);
      await expandSection(user, 'Status');

      const activeLabel = screen.getByText('Active').closest('label');
      expect(activeLabel).not.toBeNull();
      await user.click(activeLabel ?? document.body);

      expect(onChange).toHaveBeenCalledWith(['active']);
    });
  });

  describe('grid layout', () => {
    it('renders radio options in a grid when columns is 2', async () => {
      const filter = createFilter({ columns: 2 });

      const { user } = render(<DataTableFilters filters={[filter]} />);

      await openFilterPanel(user);
      await expandSection(user, 'Status');

      const radioGroup = screen.getByRole('radiogroup');
      expect(radioGroup).toHaveClass('grid-cols-2');
    });
  });

  describe('scrollable panel', () => {
    it('caps the popover height and scrolls long option lists', async () => {
      const manyOptions = Array.from({ length: 30 }, (_, index) => ({
        value: `option-${index}`,
        label: `Option ${index}`,
      }));
      const filter = createFilter({
        key: 'assignee',
        title: 'Assignee',
        options: manyOptions,
      });

      const { user } = render(<DataTableFilters filters={[filter]} />);

      await openFilterPanel(user);
      await expandSection(user, 'Assignee');

      const scrollRegion = document.querySelector('.overflow-y-auto');
      expect(scrollRegion).not.toBeNull();
      expect(scrollRegion?.parentElement).toHaveClass('overflow-hidden');
    });
  });

  describe('accessibility', () => {
    it('passes axe audit with radio filters expanded', async () => {
      const filter = createFilter({ selectedValues: ['active'] });

      const { user } = render(<DataTableFilters filters={[filter]} />);

      await openFilterPanel(user);
      await expandSection(user, 'Status');

      const radioGroup = screen.getByRole('radiogroup');
      await checkAccessibility(radioGroup);
    });

    it('passes axe audit with checkbox filters expanded', async () => {
      const filter = createFilter({
        multiSelect: true,
        selectedValues: ['active'],
      });

      const { user } = render(<DataTableFilters filters={[filter]} />);

      await openFilterPanel(user);
      await expandSection(user, 'Status');

      const checkboxes = screen.getAllByRole('checkbox');
      const firstCheckbox = checkboxes[0];
      expect(firstCheckbox).toBeDefined();
      const filterContent = firstCheckbox?.closest('[class*="flex flex-col"]');
      expect(filterContent).not.toBeNull();
      if (filterContent) await checkAccessibility(filterContent);
    });
  });
});
