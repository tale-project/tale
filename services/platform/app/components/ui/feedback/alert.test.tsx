import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/utils/render';
import { checkAccessibility } from '@/test/utils/a11y';
import { Alert, AlertTitle, AlertDescription } from './alert';
import { AlertCircle } from 'lucide-react';

describe('Alert', () => {
  describe('rendering', () => {
    it('renders with children', () => {
      render(<Alert>Alert content</Alert>);
      expect(screen.getByRole('alert')).toHaveTextContent('Alert content');
    });

    it('renders with title and description', () => {
      render(
        <Alert>
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>Something went wrong</AlertDescription>
        </Alert>
      );
      expect(screen.getByRole('alert')).toHaveTextContent('Error');
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    });

    it('renders with icon', () => {
      render(
        <Alert>
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>Error</AlertTitle>
        </Alert>
      );
      expect(screen.getByRole('alert').querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('variants', () => {
    it.each(['default', 'destructive', 'warning'] as const)(
      'renders %s variant',
      (variant) => {
        render(<Alert variant={variant}>Content</Alert>);
        expect(screen.getByRole('alert')).toBeInTheDocument();
      }
    );

    it('applies destructive styling', () => {
      render(<Alert variant="destructive">Error</Alert>);
      expect(screen.getByRole('alert').className).toContain('border-destructive');
    });

    it('applies warning styling', () => {
      render(<Alert variant="warning">Warning</Alert>);
      expect(screen.getByRole('alert').className).toContain('border-amber');
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <Alert>
          <AlertTitle>Title</AlertTitle>
          <AlertDescription>Description</AlertDescription>
        </Alert>
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
      expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
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
});

describe('AlertTitle', () => {
  it('renders as h5', () => {
    render(<AlertTitle>Title</AlertTitle>);
    expect(screen.getByRole('heading', { level: 5 })).toHaveTextContent('Title');
  });

  it('applies custom className', () => {
    render(<AlertTitle className="custom">Title</AlertTitle>);
    expect(screen.getByRole('heading')).toHaveClass('custom');
  });
});

describe('AlertDescription', () => {
  it('renders content', () => {
    render(<AlertDescription>Description text</AlertDescription>);
    expect(screen.getByText('Description text')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(<AlertDescription className="custom">Text</AlertDescription>);
    expect(screen.getByText('Text')).toHaveClass('custom');
  });
});
