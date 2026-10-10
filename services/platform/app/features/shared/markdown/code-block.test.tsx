import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';

import { CodeBlock, HighlightedCode } from './code-block';

vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Mock Shiki — returns the `{ html, language }` shape the shared
// `@tale/ui/markdown/shiki` exports so callers extracting `.html` work.
vi.mock('@/lib/utils/shiki', () => ({
  peekHighlightedCode: vi.fn(
    (): ReturnType<typeof peekHighlightedCode> => null,
  ),
  highlightCode: vi.fn((code: string, language: string) =>
    Promise.resolve({
      html: `<pre class="shiki"><code><span class="line">${code}</span></code></pre>`,
      language,
    }),
  ),
}));

// Mock theme provider
const theme = vi.hoisted(() => ({ value: 'dark' }));
vi.mock('@tale/ui/theme', () => ({
  useTheme: () => ({ resolvedTheme: theme.value }),
}));

// Mock i18n
vi.mock('@tale/ui/i18n/client', () => ({
  useT: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'actions.copy': 'Copy',
        'actions.copied': 'Copied',
      };
      return translations[key] ?? key;
    },
  }),
}));

import { highlightCode, peekHighlightedCode } from '@/lib/utils/shiki';

const DEBOUNCE_MS = 150;

describe('HighlightedCode', () => {
  beforeEach(() => {
    theme.value = 'dark';
    vi.stubGlobal('IntersectionObserver', undefined);
    vi.useFakeTimers();
    vi.mocked(highlightCode).mockClear();
    vi.mocked(peekHighlightedCode).mockReturnValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('renders cached syntax immediately without waiting for the debounce', async () => {
    vi.mocked(peekHighlightedCode).mockReturnValue({
      html: '<pre><code><span class="line">warm</span></code></pre>',
      language: 'js',
    });
    const { container } = render(<HighlightedCode lang="js" code="warm" />);
    expect(container.querySelector('.line')).toHaveTextContent('warm');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });
    expect(highlightCode).not.toHaveBeenCalled();
  });

  it('renders plain text immediately (before Shiki completes)', () => {
    const { container } = render(
      <HighlightedCode lang="js" code="const x = 1;" />,
    );

    const code = container.querySelector('code');
    expect(code?.textContent).toBe('const x = 1;');
    // Shiki not called yet (debounce hasn't fired)
    expect(highlightCode).not.toHaveBeenCalled();
  });

  it('keeps offscreen code readable without highlighting until it approaches the viewport', async () => {
    let notify: IntersectionObserverCallback;
    vi.stubGlobal(
      'IntersectionObserver',
      vi.fn(function (callback: IntersectionObserverCallback) {
        notify = callback;
        return { observe: vi.fn(), disconnect: vi.fn() };
      }),
    );
    const { container } = render(
      <HighlightedCode lang="js" code="const offscreen = true;" />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 10);
    });
    const code = container.querySelector('code')!;
    expect(code.textContent).toBe('const offscreen = true;');
    expect(highlightCode).not.toHaveBeenCalled();

    act(() =>
      notify(
        [
          {
            target: code,
            isIntersecting: true,
            boundingClientRect: code.getBoundingClientRect(),
            intersectionRect: code.getBoundingClientRect(),
            intersectionRatio: 1,
            rootBounds: null,
            time: 0,
          },
        ],
        {} as IntersectionObserver,
      ),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });
    expect(highlightCode).toHaveBeenCalledOnce();
    expect(code.textContent).toBe('const offscreen = true;');
    for (const isIntersecting of [false, true]) {
      act(() =>
        notify(
          [
            {
              target: code,
              isIntersecting,
              boundingClientRect: code.getBoundingClientRect(),
              intersectionRect: code.getBoundingClientRect(),
              intersectionRatio: isIntersecting ? 1 : 0,
              rootBounds: null,
              time: 0,
            },
          ],
          {} as IntersectionObserver,
        ),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
      });
    }
    expect(highlightCode).toHaveBeenCalledOnce();
  });

  it('drops stale decoration when language and theme change without changing the source', async () => {
    const { container, rerender } = render(
      <HighlightedCode lang="js" code="value" />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });
    expect(container.querySelector('.line')).not.toBeNull();
    theme.value = 'light';
    rerender(<HighlightedCode lang="py" code="value" />);
    expect(container).toHaveTextContent('value');
    expect(container.querySelector('.line')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });
    expect(highlightCode).toHaveBeenLastCalledWith('value', 'py', 'min-light');
    expect(highlightCode).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.line')).not.toBeNull();
  });

  it('highlights after debounce completes', async () => {
    const { container } = render(
      <HighlightedCode lang="js" code="const x = 1;" />,
    );

    // Advance past debounce
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
      // Flush the Shiki promise
      await vi.runAllTimersAsync();
    });

    expect(highlightCode).toHaveBeenCalledTimes(1);
    // Should now show highlighted HTML
    const code = container.querySelector('code');
    expect(code?.innerHTML).toContain('const x = 1;');
  });

  it('does not call Shiki when code changes rapidly (streaming)', async () => {
    const { rerender } = render(
      <HighlightedCode lang="py" code="def foo():" />,
    );

    // Simulate streaming: code changes every 50ms (before 150ms debounce)
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    rerender(<HighlightedCode lang="py" code="def foo():\n  x = 1" />);

    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    rerender(<HighlightedCode lang="py" code="def foo():\n  x = 1\n  y = 2" />);

    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    // Shiki should NOT have been called — debounce keeps resetting
    expect(highlightCode).not.toHaveBeenCalled();
  });

  it('shows plain text for current code during streaming (never stale)', async () => {
    const { container, rerender } = render(
      <HighlightedCode lang="py" code="line1" />,
    );

    // Let first highlight complete
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
      await vi.runAllTimersAsync();
    });
    expect(highlightCode).toHaveBeenCalledTimes(1);

    // Now simulate streaming — code changes
    rerender(<HighlightedCode lang="py" code={'line1\nline2'} />);

    // Should show plain text for the NEW code (not stale highlighted HTML)
    const code = container.querySelector('code');
    expect(code?.textContent).toContain('line1');
    expect(code?.textContent).toContain('line2');
  });

  it('highlights once after streaming stops', async () => {
    const { rerender } = render(<HighlightedCode lang="py" code="v1" />);

    // Rapid changes (streaming)
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    rerender(<HighlightedCode lang="py" code="v2" />);

    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    rerender(<HighlightedCode lang="py" code="v3" />);

    // Streaming stops — let debounce complete
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
      await vi.runAllTimersAsync();
    });

    // Shiki should have been called exactly once (for the final "v3")
    expect(highlightCode).toHaveBeenCalledTimes(1);
    expect(highlightCode).toHaveBeenCalledWith('v3', 'py', 'min-dark');
  });
});

describe('CodeBlock', () => {
  describe('accessibility', () => {
    it('passes axe audit for code block', async () => {
      const { container } = render(
        <CodeBlock lang="javascript">
          <code>const x = 1;</code>
        </CodeBlock>,
      );
      await checkAccessibility(container);
    });
  });
});
