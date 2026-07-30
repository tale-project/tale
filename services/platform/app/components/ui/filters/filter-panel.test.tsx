// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { pickFilterOption } from '@/tests/utils/filters';
import { render, screen } from '@/tests/utils/render';

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
