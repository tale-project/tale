import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { StatGrid } from './stat-grid';

describe('StatGrid', () => {
  describe('rendering', () => {
    it('renders items', () => {
      render(<StatGrid items={[{ label: 'Count', value: '42' }]} />);
      expect(screen.getByText('Count')).toBeInTheDocument();
      expect(screen.getByText('42')).toBeInTheDocument();
    });

    it('renders as a dl element', () => {
      const { container } = render(
        <StatGrid items={[{ label: 'Count', value: '42' }]} />,
      );
      expect(container.querySelector('dl')).toBeInTheDocument();
    });

    it('applies default 2-column grid', () => {
      const { container } = render(
        <StatGrid
          items={[
            { label: 'A', value: '1' },
            { label: 'B', value: '2' },
          ]}
        />,
      );
      expect(container.firstChild).toHaveClass('grid-cols-2');
    });

    it('applies custom column count', () => {
      const { container } = render(
        <StatGrid cols={3} items={[{ label: 'A', value: '1' }]} />,
      );
      expect(container.firstChild).toHaveClass('grid-cols-3');
    });

    it('applies custom className', () => {
      const { container } = render(
        <StatGrid
          className="custom-class"
          items={[{ label: 'A', value: '1' }]}
        />,
      );
      expect(container.firstChild).toHaveClass('custom-class');
    });

    it('applies col-span-2 for colSpan items', () => {
      const { container } = render(
        <StatGrid
          items={[{ label: 'Wide', value: 'full width', colSpan: 2 }]}
        />,
      );
      expect(container.querySelector('.col-span-2')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <StatGrid
          items={[
            { label: 'Revenue', value: '$12,400' },
            { label: 'Orders', value: '342' },
          ]}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
