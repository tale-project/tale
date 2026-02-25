import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { Heading } from './heading';

describe('Heading', () => {
  describe('rendering', () => {
    it('renders as h2 by default', () => {
      render(<Heading>title</Heading>);
      expect(screen.getByText('title').tagName).toBe('H2');
    });

    it('renders correct heading level', () => {
      const levels = [1, 2, 3, 4, 5, 6] as const;
      levels.forEach((level) => {
        const { unmount } = render(<Heading level={level}>title</Heading>);
        expect(screen.getByText('title').tagName).toBe(`H${level}`);
        unmount();
      });
    });

    it('renders children', () => {
      render(<Heading>page title</Heading>);
      expect(screen.getByText('page title')).toBeInTheDocument();
    });

    it('applies custom className', () => {
      render(<Heading className="custom">title</Heading>);
      expect(screen.getByText('title')).toHaveClass('custom');
    });
  });

  describe('variants', () => {
    it('applies default styles', () => {
      render(<Heading>title</Heading>);
      const el = screen.getByText('title');
      expect(el.className).toContain('text-base');
      expect(el.className).toContain('font-semibold');
      expect(el.className).toContain('text-foreground');
    });

    it('applies size variant', () => {
      render(<Heading size="lg">title</Heading>);
      expect(screen.getByText('title').className).toContain('text-lg');
    });

    it('applies weight variant', () => {
      render(<Heading weight="medium">title</Heading>);
      expect(screen.getByText('title').className).toContain('font-medium');
    });

    it('applies tracking variant', () => {
      render(<Heading tracking="tight">title</Heading>);
      expect(screen.getByText('title').className).toContain('tracking-tight');
    });
  });

  describe('boolean modifiers', () => {
    it('applies truncate class', () => {
      render(<Heading truncate>title</Heading>);
      expect(screen.getByText('title').className).toContain('truncate');
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <main>
          <Heading level={1}>Page title</Heading>
        </main>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with heading hierarchy', async () => {
      const { container } = render(
        <main>
          <Heading level={1}>Title</Heading>
          <Heading level={2}>Subtitle</Heading>
        </main>,
      );
      await checkAccessibility(container);
    });
  });
});
