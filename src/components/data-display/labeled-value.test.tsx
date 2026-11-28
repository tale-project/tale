import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { LabeledValue, LabeledValueGroup } from './labeled-value';

describe('LabeledValue', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <LabeledValue label="Email">john@example.com</LabeledValue>,
      );
      await checkAccessibility(container);
    });

    it('has group role with aria-labelledby', () => {
      render(<LabeledValue label="Email">john@example.com</LabeledValue>);
      const group = screen.getByRole('group');
      expect(group).toHaveAttribute('aria-labelledby');
    });
  });
});

describe('LabeledValueGroup', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <LabeledValueGroup>
          <LabeledValue label="Name">John Doe</LabeledValue>
          <LabeledValue label="Email">john@example.com</LabeledValue>
        </LabeledValueGroup>,
      );
      await checkAccessibility(container);
    });
  });
});
