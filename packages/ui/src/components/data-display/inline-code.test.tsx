import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { InlineCode } from './inline-code';

describe('InlineCode', () => {
  describe('rendering', () => {
    it('renders as code element', () => {
      render(<InlineCode>test</InlineCode>);
      expect(screen.getByText('test').tagName).toBe('CODE');
    });

    it('renders children', () => {
      render(<InlineCode>{'{{variable}}'}</InlineCode>);
      expect(screen.getByText('{{variable}}')).toBeInTheDocument();
    });

    it('applies custom className', () => {
      render(<InlineCode className="custom">code</InlineCode>);
      expect(screen.getByText('code')).toHaveClass('custom');
    });

    it('has base styling classes', () => {
      render(<InlineCode>code</InlineCode>);
      const el = screen.getByText('code');
      expect(el.className).toContain('bg-muted');
      expect(el.className).toContain('font-mono');
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <p>
          Use <InlineCode>api_key</InlineCode> to connect.
        </p>,
      );
      await checkAccessibility(container);
    });
  });
});
