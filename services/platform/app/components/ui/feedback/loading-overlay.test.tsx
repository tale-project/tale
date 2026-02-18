import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { LoadingOverlay } from './loading-overlay';

describe('LoadingOverlay', () => {
  describe('rendering', () => {
    it('renders message text', () => {
      render(<LoadingOverlay message="Updating..." />);
      expect(
        screen.getByText('Updating...', { selector: '.text-sm' }),
      ).toBeInTheDocument();
    });

    it('renders a spinner', () => {
      const { container } = render(<LoadingOverlay message="Loading..." />);
      expect(container.querySelector('[role="status"]')).toBeInTheDocument();
    });

    it('applies custom className', () => {
      const { container } = render(
        <LoadingOverlay message="Saving..." className="z-50" />,
      );
      expect(container.firstChild).toHaveClass('z-50');
    });

    it('has backdrop blur styling', () => {
      const { container } = render(<LoadingOverlay message="Processing..." />);
      expect(container.firstChild).toHaveClass('backdrop-blur-sm');
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <LoadingOverlay message="Updating items..." />,
      );
      await checkAccessibility(container);
    });

    it('has role status for screen readers', () => {
      const { container } = render(<LoadingOverlay message="Saving..." />);
      expect(container.querySelector('[role="status"]')).toBeInTheDocument();
    });

    it('has aria-live polite', () => {
      const { container } = render(<LoadingOverlay message="Loading..." />);
      expect(
        container.querySelector('[aria-live="polite"]'),
      ).toBeInTheDocument();
    });
  });
});
