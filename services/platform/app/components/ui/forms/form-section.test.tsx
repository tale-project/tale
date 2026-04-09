import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { FormSection } from './form-section';

describe('FormSection', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <FormSection label="Settings" description="Configure your settings">
          <input type="text" aria-label="Setting value" />
        </FormSection>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit without label', async () => {
      const { container } = render(
        <FormSection>
          <input type="text" aria-label="Setting value" />
        </FormSection>,
      );
      await checkAccessibility(container);
    });

    it('has group role with aria-labelledby when label provided', () => {
      render(
        <FormSection label="Settings">
          <p>Content</p>
        </FormSection>,
      );
      const group = screen.getByRole('group');
      expect(group).toHaveAttribute('aria-labelledby');
    });

    it('has aria-describedby when description provided', () => {
      render(
        <FormSection label="Settings" description="A description">
          <p>Content</p>
        </FormSection>,
      );
      const group = screen.getByRole('group');
      expect(group).toHaveAttribute('aria-describedby');
    });
  });
});
