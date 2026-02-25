import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

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

    it('renders children', () => {
      render(<Text>some text content</Text>);
      expect(screen.getByText('some text content')).toBeInTheDocument();
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
      const el = screen.getByText('text');
      expect(el.className).toContain('text-sm');
      expect(el.className).toContain('text-muted-foreground');
    });

    it('applies caption variant', () => {
      render(<Text variant="caption">text</Text>);
      const el = screen.getByText('text');
      expect(el.className).toContain('text-xs');
      expect(el.className).toContain('text-muted-foreground');
    });

    it('applies label variant', () => {
      render(<Text variant="label">text</Text>);
      const el = screen.getByText('text');
      expect(el.className).toContain('text-sm');
      expect(el.className).toContain('font-medium');
    });

    it('applies code variant', () => {
      render(<Text variant="code">text</Text>);
      const el = screen.getByText('text');
      expect(el.className).toContain('text-xs');
      expect(el.className).toContain('font-mono');
    });

    it('applies error variant', () => {
      render(<Text variant="error">text</Text>);
      const el = screen.getByText('text');
      expect(el.className).toContain('text-sm');
      expect(el.className).toContain('text-destructive');
    });

    it('applies success variant', () => {
      render(<Text variant="success">text</Text>);
      const el = screen.getByText('text');
      expect(el.className).toContain('font-medium');
      expect(el.className).toContain('text-success');
    });

    it('applies body-sm variant', () => {
      render(<Text variant="body-sm">text</Text>);
      const el = screen.getByText('text');
      expect(el.className).toContain('text-xs');
      expect(el.className).toContain('text-foreground');
    });

    it('applies label-sm variant', () => {
      render(<Text variant="label-sm">text</Text>);
      const el = screen.getByText('text');
      expect(el.className).toContain('text-xs');
      expect(el.className).toContain('font-medium');
    });

    it('applies error-sm variant', () => {
      render(<Text variant="error-sm">text</Text>);
      const el = screen.getByText('text');
      expect(el.className).toContain('text-xs');
      expect(el.className).toContain('text-destructive');
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
    it('passes axe audit for p element', async () => {
      const { container } = render(<Text>Paragraph text</Text>);
      await checkAccessibility(container);
    });

    it('passes axe audit for span element', async () => {
      const { container } = render(
        <p>
          Hello <Text as="span">inline text</Text>
        </p>,
      );
      await checkAccessibility(container);
    });
  });
});
