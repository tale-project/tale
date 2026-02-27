import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { StatItem } from './stat-item';

describe('StatItem', () => {
  describe('rendering', () => {
    it('renders label in a dt element', () => {
      render(
        <dl>
          <StatItem label="Total revenue">$1,200</StatItem>
        </dl>,
      );
      const dt = screen.getByText('Total revenue').closest('dt');
      expect(dt).toBeInTheDocument();
    });

    it('renders children in a dd element', () => {
      render(
        <dl>
          <StatItem label="Total revenue">$1,200</StatItem>
        </dl>,
      );
      const dd = screen.getByText('$1,200').closest('dd');
      expect(dd).toBeInTheDocument();
    });

    it('renders complex children', () => {
      render(
        <dl>
          <StatItem label="Status">
            <span>Active</span>
          </StatItem>
        </dl>,
      );
      expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('applies custom className', () => {
      const { container } = render(
        <dl>
          <StatItem label="Count" className="custom-class">
            42
          </StatItem>
        </dl>,
      );
      const statItem = container.querySelector('.custom-class');
      expect(statItem).toBeInTheDocument();
    });

    it('applies col-span-2 when colSpan is 2', () => {
      const { container } = render(
        <dl>
          <StatItem label="Description" colSpan={2}>
            Full width content
          </StatItem>
        </dl>,
      );
      const statItem = container.querySelector('.col-span-2');
      expect(statItem).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <dl>
          <StatItem label="Total orders">128</StatItem>
        </dl>,
      );
      await checkAccessibility(container);
    });
  });
});
