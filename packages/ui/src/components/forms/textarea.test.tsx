import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { Textarea } from './textarea';

describe('Textarea', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<Textarea aria-label="Bio" />);
      await checkAccessibility(container);
    });
  });

  describe('border visibility', () => {
    // Regression test for #1478: textareas shared the faint light-mode border
    // with inputs and must likewise use the stronger --color-border-input token.
    it('uses the input-specific border token, not the faint base border', () => {
      const { container } = render(<Textarea aria-label="Notes" />);
      const textarea = container.querySelector('textarea');
      expect(textarea?.className).toContain('--color-border-input');
      expect(textarea?.className).not.toContain('--color-border-base');
    });
  });
});
