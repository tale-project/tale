import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/utils/render';
import { checkAccessibility } from '@/test/utils/a11y';
import { Badge } from './badge';
import { Check } from 'lucide-react';

describe('Badge', () => {
  describe('rendering', () => {
    it('renders with text', () => {
      render(<Badge>Active</Badge>);
      expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('renders with dot', () => {
      const { container } = render(<Badge dot>Status</Badge>);
      expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
    });

    it('renders with icon', () => {
      const { container } = render(<Badge icon={Check}>Verified</Badge>);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('icon has aria-hidden', () => {
      const { container } = render(<Badge icon={Check}>Verified</Badge>);
      expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('variants', () => {
    it.each([
      'outline',
      'destructive',
      'orange',
      'yellow',
      'blue',
      'green',
    ] as const)('renders %s variant', (variant) => {
      render(<Badge variant={variant}>Badge</Badge>);
      expect(screen.getByText('Badge')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<Badge>Badge</Badge>);
      await checkAccessibility(container);
    });

    it('passes axe audit with icon', async () => {
      const { container } = render(<Badge icon={Check}>Verified</Badge>);
      await checkAccessibility(container);
    });

    it('has title for string children', () => {
      const { container } = render(<Badge>Long text</Badge>);
      expect(container.firstChild).toHaveAttribute('title', 'Long text');
    });

    it('dot has aria-hidden', () => {
      const { container } = render(<Badge dot>Status</Badge>);
      const dotWrapper = container.querySelector('.shrink-0');
      expect(dotWrapper).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('styling', () => {
    it('applies custom className', () => {
      const { container } = render(<Badge className="custom-class">Badge</Badge>);
      expect(container.firstChild).toHaveClass('custom-class');
    });

    it('truncates long text', () => {
      render(<Badge>Very long badge text that should be truncated</Badge>);
      expect(screen.getByText(/Very long/)).toHaveClass('truncate');
    });
  });
});
