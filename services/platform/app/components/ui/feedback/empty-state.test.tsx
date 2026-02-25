import { FileText } from 'lucide-react';
import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  describe('rendering', () => {
    it('renders title', () => {
      render(<EmptyState title="No results found" />);
      expect(screen.getByRole('heading')).toHaveTextContent('No results found');
    });

    it('renders description when provided', () => {
      render(
        <EmptyState
          title="No results"
          description="Try adjusting your filters"
        />,
      );
      expect(
        screen.getByText('Try adjusting your filters'),
      ).toBeInTheDocument();
    });

    it('does not render description when omitted', () => {
      render(<EmptyState title="No results" />);
      expect(screen.queryByText(/try/i)).not.toBeInTheDocument();
    });

    it('renders icon when provided', () => {
      const { container } = render(
        <EmptyState title="No documents" icon={FileText} />,
      );
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('renders without icon', () => {
      const { container } = render(<EmptyState title="No items" />);
      expect(container.querySelector('svg')).not.toBeInTheDocument();
    });

    it('renders action when provided', () => {
      render(
        <EmptyState
          title="No items"
          action={<button type="button">Create item</button>}
        />,
      );
      expect(
        screen.getByRole('button', { name: 'Create item' }),
      ).toBeInTheDocument();
    });

    it('does not render action slot when omitted', () => {
      render(<EmptyState title="No items" />);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('applies custom className', () => {
      const { container } = render(
        <EmptyState title="Empty" className="custom-class" />,
      );
      expect(container.firstChild).toHaveClass('custom-class');
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <EmptyState
          title="No documents"
          description="Upload a file to get started"
          icon={FileText}
          action={<button type="button">Upload</button>}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
