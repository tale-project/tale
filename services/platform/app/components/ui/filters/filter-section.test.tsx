import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { FilterSection } from './filter-section';

describe('FilterSection', () => {
  const defaultProps = {
    title: 'Status',
    isExpanded: false,
    onToggle: vi.fn(),
  };

  describe('rendering', () => {
    it('renders the title in uppercase', () => {
      render(
        <FilterSection {...defaultProps}>
          <span>Content</span>
        </FilterSection>,
      );
      expect(screen.getByText('Status')).toBeInTheDocument();
      expect(screen.getByText('Status')).toHaveClass('uppercase');
    });

    it('does not render children when collapsed', () => {
      render(
        <FilterSection {...defaultProps}>
          <span>Content</span>
        </FilterSection>,
      );
      expect(screen.queryByText('Content')).not.toBeInTheDocument();
    });

    it('renders children when expanded', () => {
      render(
        <FilterSection {...defaultProps} isExpanded>
          <span>Content</span>
        </FilterSection>,
      );
      expect(screen.getByText('Content')).toBeInTheDocument();
    });

    it('does not render selected count badge when count is 0', () => {
      render(
        <FilterSection {...defaultProps} selectedCount={0}>
          <span>Content</span>
        </FilterSection>,
      );
      expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
    });

    it('renders selected count badge', () => {
      render(
        <FilterSection {...defaultProps} selectedCount={3}>
          <span>Content</span>
        </FilterSection>,
      );
      expect(screen.getByText('3 selected')).toBeInTheDocument();
    });

    it('renders blue dot when hasSelection is true and selectedCount is 0', () => {
      const { container } = render(
        <FilterSection {...defaultProps} hasSelection>
          <span>Content</span>
        </FilterSection>,
      );
      const dot = container.querySelector('.bg-blue-600.rounded-full');
      expect(dot).toBeInTheDocument();
      expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
    });

    it('does not render blue dot when selectedCount is provided', () => {
      const { container } = render(
        <FilterSection {...defaultProps} hasSelection selectedCount={2}>
          <span>Content</span>
        </FilterSection>,
      );
      const dot = container.querySelector('.bg-blue-600.rounded-full');
      expect(dot).not.toBeInTheDocument();
      expect(screen.getByText('2 selected')).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('calls onToggle when header is clicked', async () => {
      const onToggle = vi.fn();
      const { user } = render(
        <FilterSection {...defaultProps} onToggle={onToggle}>
          <span>Content</span>
        </FilterSection>,
      );

      await user.click(screen.getByRole('button'));
      expect(onToggle).toHaveBeenCalledOnce();
    });

    it('toggles expanded state on keyboard Enter', async () => {
      const onToggle = vi.fn();
      const { user } = render(
        <FilterSection {...defaultProps} onToggle={onToggle}>
          <span>Content</span>
        </FilterSection>,
      );

      screen.getByRole('button').focus();
      await user.keyboard('{Enter}');
      expect(onToggle).toHaveBeenCalledOnce();
    });
  });

  describe('accessibility', () => {
    it('passes axe audit when collapsed', async () => {
      const { container } = render(
        <FilterSection {...defaultProps}>
          <span>Content</span>
        </FilterSection>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when expanded', async () => {
      const { container } = render(
        <FilterSection {...defaultProps} isExpanded>
          <span>Content</span>
        </FilterSection>,
      );
      await checkAccessibility(container);
    });

    it('has aria-expanded attribute', () => {
      render(
        <FilterSection {...defaultProps} isExpanded>
          <span>Content</span>
        </FilterSection>,
      );
      expect(screen.getByRole('button')).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    });

    it('sets aria-expanded to false when collapsed', () => {
      render(
        <FilterSection {...defaultProps}>
          <span>Content</span>
        </FilterSection>,
      );
      expect(screen.getByRole('button')).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    });
  });
});
