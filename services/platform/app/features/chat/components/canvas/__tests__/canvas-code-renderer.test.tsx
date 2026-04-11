import { cleanup, render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';

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

vi.mock('@/app/components/theme/theme-provider', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' }),
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'canvas.codeEditor': 'Code editor',
      };
      return translations[key] ?? key;
    },
  }),
}));

import { highlightCode } from '@/lib/utils/shiki';

import { CanvasCodeRenderer } from '../canvas-code-renderer';

describe('CanvasCodeRenderer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(highlightCode).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  describe('preview mode', () => {
    it('renders highlighted code with Shiki', async () => {
      const { container } = render(
        <CanvasCodeRenderer
          code="const x = 1;"
          language="javascript"
          isEditing={false}
          onContentChange={vi.fn()}
        />,
      );

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(highlightCode).toHaveBeenCalledWith(
        'const x = 1;',
        'javascript',
        'github-dark',
      );
      const code = container.querySelector('code');
      expect(code?.innerHTML).toContain('const x = 1;');
    });

    it('applies code-line-numbers class', async () => {
      const { container } = render(
        <CanvasCodeRenderer
          code="const x = 1;"
          language="javascript"
          isEditing={false}
          onContentChange={vi.fn()}
        />,
      );

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(container.querySelector('.code-line-numbers')).not.toBeNull();
    });

    it('shows plain text fallback before Shiki resolves', () => {
      const { container } = render(
        <CanvasCodeRenderer
          code="const x = 1;"
          language="javascript"
          isEditing={false}
          onContentChange={vi.fn()}
        />,
      );

      const code = container.querySelector('code');
      expect(code?.textContent).toBe('const x = 1;');
    });
  });

  describe('edit mode', () => {
    it('renders a textarea with aria-label using translation key', () => {
      render(
        <CanvasCodeRenderer
          code="const x = 1;"
          language="javascript"
          isEditing={true}
          onContentChange={vi.fn()}
        />,
      );

      const textarea = screen.getByRole('textbox', { name: 'Code editor' });
      expect(textarea).toBeInTheDocument();
    });

    it('shows Shiki-highlighted pre layer behind textarea', async () => {
      const { container } = render(
        <CanvasCodeRenderer
          code="const x = 1;"
          language="javascript"
          isEditing={true}
          onContentChange={vi.fn()}
        />,
      );

      await act(async () => {
        vi.advanceTimersByTime(150);
        await vi.runAllTimersAsync();
      });

      const pre = container.querySelector('pre');
      expect(pre).toHaveAttribute('aria-hidden', 'true');
      expect(pre?.classList.contains('pointer-events-none')).toBe(true);
      expect(pre?.querySelector('code')?.innerHTML).toContain('const x = 1;');
    });

    it('propagates content changes via onContentChange', async () => {
      const onContentChange = vi.fn();
      vi.useRealTimers();

      render(
        <CanvasCodeRenderer
          code="const x = 1;"
          language="javascript"
          isEditing={true}
          onContentChange={onContentChange}
        />,
      );

      const user = userEvent.setup();
      const textarea = screen.getByRole('textbox', { name: 'Code editor' });
      await user.click(textarea);
      await user.type(textarea, '\n');

      expect(onContentChange).toHaveBeenCalled();
    });

    it('inserts 2-space indentation on Tab key', async () => {
      const onContentChange = vi.fn();
      vi.useRealTimers();

      render(
        <CanvasCodeRenderer
          code="const x = 1;"
          language="javascript"
          isEditing={true}
          onContentChange={onContentChange}
        />,
      );

      const user = userEvent.setup();
      const textarea = screen.getByRole('textbox', { name: 'Code editor' });
      await user.click(textarea);
      await user.tab();

      expect(onContentChange).toHaveBeenCalledWith(
        expect.stringContaining('  '),
      );
    });
  });

  describe('mode switching', () => {
    it('preserves content when toggling between edit and preview', async () => {
      const code = 'function hello() {}';
      const { rerender, container } = render(
        <CanvasCodeRenderer
          code={code}
          language="javascript"
          isEditing={false}
          onContentChange={vi.fn()}
        />,
      );

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      rerender(
        <CanvasCodeRenderer
          code={code}
          language="javascript"
          isEditing={true}
          onContentChange={vi.fn()}
        />,
      );

      const textarea = screen.getByRole('textbox', { name: 'Code editor' });
      expect(textarea).toHaveValue(code);

      rerender(
        <CanvasCodeRenderer
          code={code}
          language="javascript"
          isEditing={false}
          onContentChange={vi.fn()}
        />,
      );

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      const codeEl = container.querySelector('code');
      expect(codeEl?.textContent).toContain('function hello() {}');
    });

    it('re-highlights with updated content when switching to preview', async () => {
      const { rerender } = render(
        <CanvasCodeRenderer
          code="v1"
          language="javascript"
          isEditing={true}
          onContentChange={vi.fn()}
        />,
      );

      vi.mocked(highlightCode).mockClear();

      rerender(
        <CanvasCodeRenderer
          code="v2"
          language="javascript"
          isEditing={false}
          onContentChange={vi.fn()}
        />,
      );

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(highlightCode).toHaveBeenCalledWith(
        'v2',
        'javascript',
        'github-dark',
      );
    });
  });

  describe('accessibility', () => {
    it('passes axe audit in preview mode', async () => {
      vi.useRealTimers();

      const { container } = render(
        <CanvasCodeRenderer
          code="const x = 1;"
          language="javascript"
          isEditing={false}
          onContentChange={vi.fn()}
        />,
      );

      await checkAccessibility(container);
    });

    it('passes axe audit in edit mode', async () => {
      vi.useRealTimers();

      const { container } = render(
        <CanvasCodeRenderer
          code="const x = 1;"
          language="javascript"
          isEditing={true}
          onContentChange={vi.fn()}
        />,
      );

      await checkAccessibility(container);
    });
  });
});
