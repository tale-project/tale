import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { Banner } from './banner';

describe('Banner', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<Banner message="Information message" />);
      await checkAccessibility(container);
    });

    it('passes axe audit for each variant', async () => {
      for (const variant of ['info', 'warning', 'success', 'error'] as const) {
        const { container } = render(
          <Banner variant={variant} message={`${variant} message`} />,
        );
        await checkAccessibility(container);
      }
    });

    it('has alert role', () => {
      render(<Banner message="Alert message" />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('dismiss button has aria-label', () => {
      render(<Banner message="Dismissible" dismissible />);
      expect(screen.getByRole('button')).toHaveAttribute('aria-label');
    });

    it('passes axe audit when not dismissible', async () => {
      const { container } = render(
        <Banner message="Non-dismissible" dismissible={false} />,
      );
      await checkAccessibility(container);
    });
  });
});
