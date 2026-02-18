import { FileText } from 'lucide-react';
import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { EmptyPlaceholder } from './empty-placeholder';

describe('EmptyPlaceholder', () => {
  describe('rendering', () => {
    it('renders message text', () => {
      render(<EmptyPlaceholder>No items found</EmptyPlaceholder>);
      expect(screen.getByText('No items found')).toBeInTheDocument();
    });

    it('renders icon when provided', () => {
      const { container } = render(
        <EmptyPlaceholder icon={FileText}>No documents</EmptyPlaceholder>,
      );
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('renders without icon', () => {
      const { container } = render(
        <EmptyPlaceholder>No items</EmptyPlaceholder>,
      );
      expect(container.querySelector('svg')).not.toBeInTheDocument();
    });

    it('applies custom className', () => {
      const { container } = render(
        <EmptyPlaceholder className="custom-class">Empty</EmptyPlaceholder>,
      );
      expect(container.firstChild).toHaveClass('custom-class');
    });

    it('has dashed border styling', () => {
      const { container } = render(<EmptyPlaceholder>Empty</EmptyPlaceholder>);
      expect(container.firstChild).toHaveClass('border-dashed');
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <EmptyPlaceholder icon={FileText}>
          No documents available
        </EmptyPlaceholder>,
      );
      await checkAccessibility(container);
    });

    it('hides icon from screen readers', () => {
      const { container } = render(
        <EmptyPlaceholder icon={FileText}>Empty</EmptyPlaceholder>,
      );
      const svg = container.querySelector('svg');
      expect(svg?.closest('[aria-hidden="true"]')).toBeInTheDocument();
    });
  });
});
