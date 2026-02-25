import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { StatItem } from './stat-item';

describe('StatItem', () => {
  describe('rendering', () => {
    it('renders label', () => {
      render(<StatItem label="Total revenue">$1,200</StatItem>);
      expect(screen.getByText('Total revenue')).toBeInTheDocument();
    });

    it('renders children', () => {
      render(<StatItem label="Total revenue">$1,200</StatItem>);
      expect(screen.getByText('$1,200')).toBeInTheDocument();
    });

    it('renders complex children', () => {
      render(
        <StatItem label="Status">
          <span>Active</span>
        </StatItem>,
      );
      expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('applies custom className', () => {
      const { container } = render(
        <StatItem label="Count" className="custom-class">
          42
        </StatItem>,
      );
      expect(container.firstChild).toHaveClass('custom-class');
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <StatItem label="Total orders">128</StatItem>,
      );
      await checkAccessibility(container);
    });
  });
});
