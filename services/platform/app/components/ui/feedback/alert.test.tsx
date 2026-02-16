import { AlertCircle } from 'lucide-react';
import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { Alert } from './alert';

describe('Alert', () => {
  describe('rendering', () => {
    it('renders with children', () => {
      render(<Alert>Alert content</Alert>);
      expect(screen.getByRole('alert')).toHaveTextContent('Alert content');
    });

    it('renders with title and description', () => {
      render(<Alert title="Error" description="Something went wrong" />);
      expect(screen.getByRole('alert')).toHaveTextContent('Error');
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Something went wrong',
      );
    });

    it('renders with icon', () => {
      render(<Alert icon={AlertCircle} title="Error" />);
      expect(
        screen.getByRole('alert').querySelector('svg'),
      ).toBeInTheDocument();
    });

    it('renders icon with aria-hidden', () => {
      render(<Alert icon={AlertCircle} title="Error" />);
      const svg = screen.getByRole('alert').querySelector('svg');
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('variants', () => {
    it.each(['default', 'destructive', 'warning'] as const)(
      'renders %s variant',
      (variant) => {
        render(<Alert variant={variant}>Content</Alert>);
        expect(screen.getByRole('alert')).toBeInTheDocument();
      },
    );

    it('applies destructive styling', () => {
      render(<Alert variant="destructive">Error</Alert>);
      expect(screen.getByRole('alert').className).toContain(
        'border-destructive',
      );
    });

    it('applies warning styling', () => {
      render(<Alert variant="warning">Warning</Alert>);
      expect(screen.getByRole('alert').className).toContain('border-amber');
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <Alert title="Title" description="Description" />,
      );
      await checkAccessibility(container);
    });

    it('has role alert', () => {
      render(<Alert>Content</Alert>);
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('has aria-live polite by default', () => {
      render(<Alert>Content</Alert>);
      expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'polite');
    });

    it('supports aria-live assertive', () => {
      render(<Alert live="assertive">Critical</Alert>);
      expect(screen.getByRole('alert')).toHaveAttribute(
        'aria-live',
        'assertive',
      );
    });

    it('has aria-atomic true', () => {
      render(<Alert>Content</Alert>);
      expect(screen.getByRole('alert')).toHaveAttribute('aria-atomic', 'true');
    });
  });

  describe('styling', () => {
    it('applies custom className', () => {
      render(<Alert className="custom-class">Content</Alert>);
      expect(screen.getByRole('alert')).toHaveClass('custom-class');
    });
  });

  describe('title rendering', () => {
    it('renders title as h5', () => {
      render(<Alert title="Title" />);
      expect(screen.getByRole('heading', { level: 5 })).toHaveTextContent(
        'Title',
      );
    });
  });

  describe('description rendering', () => {
    it('renders description', () => {
      render(<Alert description="Description text" />);
      expect(screen.getByText('Description text')).toBeInTheDocument();
    });
  });
});
