import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { Input } from './input';

describe('Input', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<Input aria-label="Email" type="email" />);
      await checkAccessibility(container);
    });
  });

  describe('border visibility', () => {
    // Regression test for #1478: in light mode the field edge was barely
    // visible because inputs used the faint incidental --color-border-base
    // (#e5e7eb on a white surface). They must use the stronger, input-specific
    // --color-border-input token instead.
    it('uses the input-specific border token, not the faint base border', () => {
      const { container } = render(<Input aria-label="Name" />);
      const input = container.querySelector('input');
      expect(input?.className).toContain('--color-border-input');
      expect(input?.className).not.toContain('--color-border-base');
    });
  });
});
