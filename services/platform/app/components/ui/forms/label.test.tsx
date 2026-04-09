import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { Label } from './label';

describe('Label', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<Label>Email</Label>);
      await checkAccessibility(container);
    });

    it('passes axe audit when required', async () => {
      const { container } = render(<Label required>Email</Label>);
      await checkAccessibility(container);
    });

    it('required indicator has aria-label', () => {
      render(<Label required>Email</Label>);
      expect(screen.getByLabelText(/required/i)).toBeInTheDocument();
    });

    it('passes axe audit with error styling', async () => {
      const { container } = render(<Label error>Email</Label>);
      await checkAccessibility(container);
    });
  });
});
