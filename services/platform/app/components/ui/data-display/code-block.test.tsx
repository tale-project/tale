import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { CodeBlock } from './code-block';

vi.mock('@/app/components/theme/theme-provider', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' }),
}));

vi.mock('@/lib/utils/shiki', () => ({
  highlightCode: vi.fn((code: string) =>
    Promise.resolve(
      `<pre class="shiki"><code>${code
        .split('\n')
        .map((line) => `<span class="line">${line}</span>`)
        .join('\n')}</code></pre>`,
    ),
  ),
  extractShikiCodeContent: vi.fn((html: string) => {
    const match = html.match(/<code[^>]*>([\s\S]*?)<\/code>/);
    return match ? match[1] : html;
  }),
}));

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

    it('renders copy button with default aria-label when copyLabel is omitted', () => {
      render(<CodeBlock copyValue="code">code</CodeBlock>);
      expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
    });

    it('applies custom className', () => {
      const { container } = render(
        <CodeBlock className="custom">code</CodeBlock>,
      );
      expect(container.firstChild).toHaveClass('custom');
    });
  });

  describe('syntax highlighting', () => {
    it('renders .line spans for line numbers when language is set', () => {
      const { container } = render(
        <CodeBlock language="javascript">
          {'const x = 1;\nconst y = 2;'}
        </CodeBlock>,
      );
      const lines = container.querySelectorAll('.line');
      expect(lines.length).toBe(2);
    });

    it('applies code-line-numbers class when language is set', () => {
      const { container } = render(
        <CodeBlock language="javascript">const x = 1;</CodeBlock>,
      );
      expect(container.querySelector('.code-line-numbers')).not.toBeNull();
    });

    it('does not apply code-line-numbers class without language', () => {
      const { container } = render(<CodeBlock>const x = 1;</CodeBlock>);
      expect(container.querySelector('.code-line-numbers')).toBeNull();
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

    it('passes axe audit with syntax highlighting', async () => {
      const { container } = render(
        <CodeBlock
          language="javascript"
          copyValue="const x = 1;"
          copyLabel="Copy code"
        >
          const x = 1;
        </CodeBlock>,
      );
      await checkAccessibility(container);
    });
  });
});
