import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { HighlightedCode } from '../code-block';

// Mock Shiki — returns a predictable HTML string
vi.mock('@/lib/utils/shiki', () => ({
  highlightCode: vi.fn((code: string) =>
    Promise.resolve(
      `<pre class="shiki"><code><span class="line">${code}</span></code></pre>`,
    ),
  ),
}));

// Mock theme provider
vi.mock('@/app/components/theme/theme-provider', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' }),
}));

import { highlightCode } from '@/lib/utils/shiki';

const DEBOUNCE_MS = 150;

describe('HighlightedCode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(highlightCode).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders plain text immediately (before Shiki completes)', () => {
    const { container } = render(
      <HighlightedCode lang="js" code="const x = 1;" />,
    );

    const spans = container.querySelectorAll('span.line');
    expect(spans.length).toBe(1);
    expect(spans[0].textContent).toBe('const x = 1;');
    // Shiki not called yet (debounce hasn't fired)
    expect(highlightCode).not.toHaveBeenCalled();
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
    const spans = container.querySelectorAll('span.line');
    expect(spans.length).toBe(2);
    expect(spans[0].textContent).toContain('line1');
    expect(spans[1].textContent).toContain('line2');
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
    expect(highlightCode).toHaveBeenCalledWith('v3', 'py', 'github-dark');
  });
});
