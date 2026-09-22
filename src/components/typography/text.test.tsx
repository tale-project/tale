import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { Text } from './text';

describe('Text', () => {
  describe('rendering', () => {
    it('renders as p element by default', () => {
      render(<Text>hello</Text>);
      expect(screen.getByText('hello').tagName).toBe('P');
    });

    it('renders as span when as="span"', () => {
      render(<Text as="span">hello</Text>);
      expect(screen.getByText('hello').tagName).toBe('SPAN');
    });

    it('renders as div when as="div"', () => {
      render(<Text as="div">hello</Text>);
      expect(screen.getByText('hello').tagName).toBe('DIV');
    });

    it('renders as label when as="label"', () => {
      render(<Text as="label">hello</Text>);
      expect(screen.getByText('hello').tagName).toBe('LABEL');
    });

    it('applies custom className', () => {
      render(<Text className="custom">text</Text>);
      expect(screen.getByText('text')).toHaveClass('custom');
    });
  });

  describe('variants', () => {
    it('applies body variant by default', () => {
      render(<Text>text</Text>);
      const el = screen.getByText('text');
      expect(el.className).toContain('text-sm');
      expect(el.className).toContain('text-foreground');
    });

    it('applies muted variant', () => {
      render(<Text variant="muted">text</Text>);
      expect(screen.getByText('text').className).toContain(
        'text-muted-foreground',
      );
    });

    it('applies code variant', () => {
      render(<Text variant="code">text</Text>);
      const el = screen.getByText('text');
      expect(el.className).toContain('text-xs');
      expect(el.className).toContain('font-mono');
    });

    it('applies success variant', () => {
      render(<Text variant="success">text</Text>);
      expect(screen.getByText('text').className).toContain('text-success');
    });
  });

  describe('modifiers', () => {
    it('applies truncate class', () => {
      render(<Text truncate>text</Text>);
      expect(screen.getByText('text').className).toContain('truncate');
    });

    it('applies text-center for align="center"', () => {
      render(<Text align="center">text</Text>);
      expect(screen.getByText('text').className).toContain('text-center');
    });

    it('applies text-right for align="right"', () => {
      render(<Text align="right">text</Text>);
      expect(screen.getByText('text').className).toContain('text-right');
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<Text>Paragraph text</Text>);
      await checkAccessibility(container);
    });
  });
});
