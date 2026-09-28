import { AlertCircle } from 'lucide-react';
import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

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

  describe('default icons', () => {
    // A banner always carries its severity glyph — color alone fails WCAG
    // 1.4.1, and an icon-less box reads as a random bordered paragraph.
    it.each(['default', 'info', 'warning', 'destructive'] as const)(
      'renders the %s variant with a glyph even when no icon is passed',
      (variant) => {
        render(<Alert variant={variant}>Content</Alert>);
        const svg = screen.getByRole('alert').querySelector('svg');
        expect(svg).toBeInTheDocument();
        expect(svg).toHaveAttribute('aria-hidden', 'true');
      },
    );

    it('renders exactly one glyph when an explicit icon overrides the default', () => {
      render(
        <Alert variant="warning" icon={AlertCircle}>
          Content
        </Alert>,
      );
      expect(screen.getByRole('alert').querySelectorAll('svg')).toHaveLength(1);
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

    it('renders a static banner (no alert role) when live is off', () => {
      render(
        <Alert live="off" title="Danger zone">
          Static content
        </Alert>,
      );
      // A `live: 'off'` banner is always-present chrome, not an announcement —
      // it must NOT be an `alert` live region.
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByText('Static content')).toBeInTheDocument();
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

    it('wraps long unbreakable description text inside the alert', () => {
      const longToken =
        '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CdzZK3D5YNR5b"}';
      render(<Alert description={`Model call failed: ${longToken}`} />);
      const description = screen.getByText(/Model call failed:/);
      expect(description).toHaveClass('break-words');
      expect(screen.getByRole('alert')).toHaveClass('min-w-0');
    });
  });
});
