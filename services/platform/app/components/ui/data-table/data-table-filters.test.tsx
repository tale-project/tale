import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

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
  const filterButton = screen.getByRole('button', { name: /filters/i });
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
    it('renders radio options in a grid when grid prop is set', async () => {
      const filter = createFilter({ grid: true });

      const { user } = render(<DataTableFilters filters={[filter]} />);

      await openFilterPanel(user);
      await expandSection(user, 'Status');

      const radioGroup = screen.getByRole('radiogroup');
      expect(radioGroup).toHaveClass('grid-cols-2');
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
