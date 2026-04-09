import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { FilterButton } from './filter-button';

describe('FilterButton', () => {
  describe('accessibility', () => {
    it('passes axe audit without active filters', async () => {
      const { container } = render(
        <FilterButton hasActiveFilters={false} onClick={vi.fn()} />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with active filters', async () => {
      const { container } = render(
        <FilterButton hasActiveFilters={true} onClick={vi.fn()} />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when loading', async () => {
      const { container } = render(
        <FilterButton hasActiveFilters={false} isLoading onClick={vi.fn()} />,
      );
      await checkAccessibility(container);
    });
  });
});
