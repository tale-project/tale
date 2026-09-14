import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { Image } from './image';

describe('Image', () => {
  describe('accessibility', () => {
    it('passes axe audit with alt text', async () => {
      const { container } = render(<Image src="/test.png" alt="Test image" />);
      await checkAccessibility(container);
    });

    it('has alt attribute', () => {
      render(<Image src="/test.png" alt="A photo" />);
      expect(screen.getByAltText('A photo')).toBeInTheDocument();
    });

    it('uses lazy loading by default', () => {
      render(<Image src="/test.png" alt="Lazy image" />);
      expect(screen.getByAltText('Lazy image')).toHaveAttribute(
        'loading',
        'lazy',
      );
    });

    it('uses eager loading with priority', () => {
      render(<Image src="/test.png" alt="Priority image" priority />);
      expect(screen.getByAltText('Priority image')).toHaveAttribute(
        'loading',
        'eager',
      );
    });
  });
});
