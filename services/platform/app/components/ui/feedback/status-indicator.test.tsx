import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { StatusIndicator } from './status-indicator';

describe('StatusIndicator', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <StatusIndicator variant="success">Active</StatusIndicator>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit for each variant', async () => {
      for (const variant of [
        'success',
        'warning',
        'error',
        'info',
        'neutral',
      ] as const) {
        const { container } = render(
          <StatusIndicator variant={variant}>{variant}</StatusIndicator>,
        );
        await checkAccessibility(container);
      }
    });

    it('dot is aria-hidden', () => {
      const { container } = render(
        <StatusIndicator variant="success">Active</StatusIndicator>,
      );
      const dot = container.querySelector('[aria-hidden="true"]');
      expect(dot).toBeInTheDocument();
    });

    it('passes axe audit without children', async () => {
      const { container } = render(<StatusIndicator variant="success" />);
      await checkAccessibility(container);
    });
  });
});
