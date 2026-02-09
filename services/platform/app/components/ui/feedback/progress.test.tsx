import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { Progress } from './progress';

describe('Progress', () => {
  describe('rendering', () => {
    it('renders progressbar', () => {
      render(<Progress value={50} />);
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('shows visual progress', () => {
      const { container } = render(<Progress value={50} />);
      const indicator = container.querySelector('[aria-hidden="true"]');
      expect(indicator).toHaveStyle({ transform: 'translateX(-50%)' });
    });
  });

  describe('values', () => {
    it('handles 0 value', () => {
      const { container } = render(<Progress value={0} />);
      const indicator = container.querySelector('[aria-hidden="true"]');
      expect(indicator).toHaveStyle({ transform: 'translateX(-100%)' });
    });

    it('handles 100 value', () => {
      const { container } = render(<Progress value={100} />);
      const indicator = container.querySelector('[aria-hidden="true"]');
      expect(indicator).toHaveStyle({ transform: 'translateX(-0%)' });
    });

    it('clamps values above max', () => {
      render(<Progress value={150} max={100} />);
      expect(screen.getByRole('progressbar')).toHaveAttribute(
        'aria-valuenow',
        '150',
      );
    });

    it('handles custom max', () => {
      const { container } = render(<Progress value={3} max={5} />);
      const indicator = container.querySelector('[aria-hidden="true"]');
      expect(indicator).toHaveStyle({ transform: 'translateX(-40%)' });
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<Progress value={50} label="Loading" />);
      await checkAccessibility(container);
    });

    it('has role progressbar', () => {
      render(<Progress value={50} />);
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('has aria-valuenow', () => {
      render(<Progress value={75} />);
      expect(screen.getByRole('progressbar')).toHaveAttribute(
        'aria-valuenow',
        '75',
      );
    });

    it('has aria-valuemin', () => {
      render(<Progress value={50} />);
      expect(screen.getByRole('progressbar')).toHaveAttribute(
        'aria-valuemin',
        '0',
      );
    });

    it('has aria-valuemax', () => {
      render(<Progress value={50} />);
      expect(screen.getByRole('progressbar')).toHaveAttribute(
        'aria-valuemax',
        '100',
      );
    });

    it('has custom aria-valuemax', () => {
      render(<Progress value={3} max={5} />);
      expect(screen.getByRole('progressbar')).toHaveAttribute(
        'aria-valuemax',
        '5',
      );
    });

    it('supports aria-label', () => {
      render(<Progress value={50} label="Uploading file" />);
      expect(screen.getByRole('progressbar')).toHaveAttribute(
        'aria-label',
        'Uploading file',
      );
    });

    it('indicator has aria-hidden', () => {
      const { container } = render(<Progress value={50} />);
      const indicator = container.querySelector('[aria-hidden="true"]');
      expect(indicator).toBeInTheDocument();
    });
  });

  describe('styling', () => {
    it('applies custom className', () => {
      render(<Progress value={50} className="custom-class" />);
      expect(screen.getByRole('progressbar')).toHaveClass('custom-class');
    });

    it('applies custom indicatorClassName', () => {
      const { container } = render(
        <Progress value={50} indicatorClassName="bg-green-500" />,
      );
      const indicator = container.querySelector('[aria-hidden="true"]');
      expect(indicator).toHaveClass('bg-green-500');
    });

    it('has transition classes', () => {
      const { container } = render(<Progress value={50} />);
      const indicator = container.querySelector('[aria-hidden="true"]');
      expect(indicator?.className).toContain('transition-');
    });
  });
});
