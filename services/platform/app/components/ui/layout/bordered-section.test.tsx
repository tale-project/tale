import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { BorderedSection } from './bordered-section';

describe('BorderedSection', () => {
  describe('rendering', () => {
    it('renders children', () => {
      render(<BorderedSection>Section content</BorderedSection>);
      expect(screen.getByText('Section content')).toBeInTheDocument();
    });

    it('has border styling', () => {
      const { container } = render(<BorderedSection>Content</BorderedSection>);
      expect(container.firstChild).toHaveClass('border');
    });

    it('applies custom className', () => {
      const { container } = render(
        <BorderedSection className="custom-class">Content</BorderedSection>,
      );
      expect(container.firstChild).toHaveClass('custom-class');
    });
  });

  describe('gap variant', () => {
    it('applies gap-2 when gap is 2', () => {
      const { container } = render(
        <BorderedSection gap={2}>Content</BorderedSection>,
      );
      expect(container.firstChild).toHaveClass('gap-2');
    });

    it('applies gap-3 when gap is 3', () => {
      const { container } = render(
        <BorderedSection gap={3}>Content</BorderedSection>,
      );
      expect(container.firstChild).toHaveClass('gap-3');
    });

    it('applies gap-4 when gap is 4', () => {
      const { container } = render(
        <BorderedSection gap={4}>Content</BorderedSection>,
      );
      expect(container.firstChild).toHaveClass('gap-4');
    });

    it('defaults to gap-3', () => {
      const { container } = render(<BorderedSection>Content</BorderedSection>);
      expect(container.firstChild).toHaveClass('gap-3');
    });
  });

  describe('padding variant', () => {
    it('applies p-3 when padding is 3', () => {
      const { container } = render(
        <BorderedSection padding={3}>Content</BorderedSection>,
      );
      expect(container.firstChild).toHaveClass('p-3');
    });

    it('applies p-4 when padding is 4', () => {
      const { container } = render(
        <BorderedSection padding={4}>Content</BorderedSection>,
      );
      expect(container.firstChild).toHaveClass('p-4');
    });

    it('defaults to p-4', () => {
      const { container } = render(<BorderedSection>Content</BorderedSection>);
      expect(container.firstChild).toHaveClass('p-4');
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <BorderedSection>
          <p>Section content</p>
        </BorderedSection>,
      );
      await checkAccessibility(container);
    });
  });
});
