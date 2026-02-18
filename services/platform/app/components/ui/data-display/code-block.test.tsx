import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { CodeBlock } from './code-block';

describe('CodeBlock', () => {
  describe('rendering', () => {
    it('renders code content', () => {
      render(<CodeBlock>const x = 1;</CodeBlock>);
      expect(screen.getByText('const x = 1;')).toBeInTheDocument();
    });

    it('renders label when provided', () => {
      render(<CodeBlock label="Example">code</CodeBlock>);
      expect(screen.getByText('Example')).toBeInTheDocument();
    });

    it('renders without label', () => {
      const { container } = render(<CodeBlock>code</CodeBlock>);
      expect(container.querySelectorAll('p')).toHaveLength(0);
    });

    it('shows copy button when copyValue is provided', () => {
      render(
        <CodeBlock copyValue="code" copyLabel="Copy code">
          code
        </CodeBlock>,
      );
      expect(
        screen.getByRole('button', { name: 'Copy code' }),
      ).toBeInTheDocument();
    });

    it('hides copy button when copyValue is not provided', () => {
      render(<CodeBlock>code</CodeBlock>);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('applies custom className', () => {
      const { container } = render(
        <CodeBlock className="custom">code</CodeBlock>,
      );
      expect(container.firstChild).toHaveClass('custom');
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <CodeBlock
          label="cURL example"
          copyValue="curl -X POST"
          copyLabel="Copy command"
        >
          curl -X POST https://example.com
        </CodeBlock>,
      );
      await checkAccessibility(container);
    });
  });
});
