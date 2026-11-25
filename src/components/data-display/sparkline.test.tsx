import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { Sparkline } from './sparkline';

describe('Sparkline', () => {
  describe('rendering', () => {
    it('renders a polyline for a multi-point series', () => {
      const { container } = render(<Sparkline data={[1, 4, 2, 6]} />);
      const polyline = container.querySelector('polyline');
      expect(polyline).toBeInTheDocument();
      // 4 points → 4 coordinate pairs.
      expect(
        polyline?.getAttribute('points')?.trim().split(/\s+/),
      ).toHaveLength(4);
    });

    it('is decorative (aria-hidden) by default', () => {
      const { container } = render(<Sparkline data={[1, 2, 3]} />);
      const svg = container.querySelector('svg');
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg).not.toHaveAttribute('role', 'img');
    });

    it('exposes itself as an image when given an aria-label', () => {
      const { container } = render(
        <Sparkline data={[1, 2, 3]} aria-label="Runs trend" />,
      );
      const svg = container.querySelector('svg');
      expect(svg).toHaveAttribute('role', 'img');
      expect(svg).toHaveAttribute('aria-label', 'Runs trend');
    });

    it('renders an area polygon when filled', () => {
      const { container } = render(<Sparkline data={[1, 2, 3]} filled />);
      expect(container.querySelector('polygon')).toBeInTheDocument();
    });

    it('renders nothing drawable for an empty series', () => {
      const { container } = render(<Sparkline data={[]} />);
      expect(container.querySelector('polyline')).not.toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('passes axe audit (decorative)', async () => {
      const { container } = render(<Sparkline data={[1, 4, 2, 6]} />);
      await checkAccessibility(container);
    });

    it('passes axe audit (labelled image)', async () => {
      const { container } = render(
        <Sparkline data={[1, 4, 2, 6]} aria-label="Runs trend" />,
      );
      await checkAccessibility(container);
    });
  });
});
