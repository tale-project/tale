import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/utils/render';
import { checkAccessibility } from '@/test/utils/a11y';
import { Spinner } from './spinner';

describe('Spinner', () => {
  describe('rendering', () => {
    it('renders spinner', () => {
      render(<Spinner />);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('has animation class', () => {
      render(<Spinner />);
      expect(screen.getByRole('status')).toHaveClass('animate-spin');
    });
  });

  describe('sizes', () => {
    it.each(['sm', 'md', 'lg'] as const)('renders %s size', (size) => {
      render(<Spinner size={size} />);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('sm has correct size class', () => {
      render(<Spinner size="sm" />);
      expect(screen.getByRole('status')).toHaveClass('size-4');
    });

    it('md has correct size class', () => {
      render(<Spinner size="md" />);
      expect(screen.getByRole('status')).toHaveClass('size-6');
    });

    it('lg has correct size class', () => {
      render(<Spinner size="lg" />);
      expect(screen.getByRole('status')).toHaveClass('size-8');
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<Spinner />);
      await checkAccessibility(container);
    });

    it('has role status', () => {
      render(<Spinner />);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('has default aria-label', () => {
      render(<Spinner />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Loading');
    });

    it('supports custom label', () => {
      render(<Spinner label="Saving" />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Saving');
    });

    it('has screen reader text', () => {
      render(<Spinner label="Processing" />);
      expect(screen.getByText('Processing')).toHaveClass('sr-only');
    });
  });

  describe('styling', () => {
    it('applies custom className', () => {
      render(<Spinner className="text-primary" />);
      expect(screen.getByRole('status')).toHaveClass('text-primary');
    });
  });
});
