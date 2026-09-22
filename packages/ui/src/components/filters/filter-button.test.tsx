import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { FilterButton } from './filter-button';

describe('FilterButton', () => {
  it('drops the visible label but keeps the accessible name when icon-only', () => {
    render(
      <FilterButton hasActiveFilters={false} iconOnly onClick={vi.fn()} />,
    );

    // The name has to survive: it is the only thing a screen reader announces
    // once the word is gone from the page.
    const button = screen.getByRole('button', { name: 'Filter' });
    expect(button).toHaveTextContent('');
  });

  it('shows the label by default', () => {
    render(<FilterButton hasActiveFilters={false} onClick={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Filter' })).toHaveTextContent(
      'Filter',
    );
  });

  describe('accessibility', () => {
    it('passes axe audit when icon-only', async () => {
      const { container } = render(
        <FilterButton hasActiveFilters iconOnly onClick={vi.fn()} />,
      );
      await checkAccessibility(container);
    });

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
