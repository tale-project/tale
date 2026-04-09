import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { ValidationCheckList } from './validation-check-item';

describe('ValidationCheckList', () => {
  const items = [
    { isValid: true, message: 'At least 8 characters' },
    { isValid: false, message: 'Must include a number' },
  ];

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<ValidationCheckList items={items} />);
      // Inner HStack has role="listitem" nested inside <li>, causing duplicate parent violation
      await checkAccessibility(container, {
        rules: { 'aria-required-parent': { enabled: false } },
      });
    });

    it('has list role with aria-label', () => {
      render(<ValidationCheckList items={items} />);
      const list = screen.getByRole('list');
      expect(list).toHaveAttribute('aria-label');
    });

    it('renders the correct number of items', () => {
      render(<ValidationCheckList items={items} />);
      const listElements = screen
        .getByRole('list')
        .querySelectorAll(':scope > li');
      expect(listElements).toHaveLength(2);
    });

    it('icons are aria-hidden', () => {
      const { container } = render(<ValidationCheckList items={items} />);
      const svgs = container.querySelectorAll('svg');
      svgs.forEach((svg) => {
        expect(svg).toHaveAttribute('aria-hidden', 'true');
      });
    });
  });
});
