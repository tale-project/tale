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

    it('passes axe audit with an info tooltip', async () => {
      const { container } = render(
        <Label info="Use a public domain.">Domain</Label>,
      );
      await checkAccessibility(container);
    });
  });

  describe('info tooltip', () => {
    it('renders a keyboard-focusable info button with an aria-label', () => {
      render(<Label info="Use a public domain.">Domain</Label>);
      const button = screen.getByRole('button', { name: /more information/i });
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute('type', 'button');
    });

    it('renders no info button when info is omitted', () => {
      render(<Label>Domain</Label>);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });
});
