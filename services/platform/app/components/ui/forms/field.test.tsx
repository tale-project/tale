import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { Field, FieldGroup } from './field';

describe('Field', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <Field label="Email">john@example.com</Field>,
      );
      await checkAccessibility(container);
    });

    it('has group role with aria-labelledby', () => {
      render(<Field label="Email">john@example.com</Field>);
      const group = screen.getByRole('group');
      expect(group).toHaveAttribute('aria-labelledby');
    });
  });
});

describe('FieldGroup', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <FieldGroup>
          <Field label="Name">John Doe</Field>
          <Field label="Email">john@example.com</Field>
        </FieldGroup>,
      );
      await checkAccessibility(container);
    });
  });
});
