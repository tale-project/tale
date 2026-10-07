import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HighlightedCode } from './highlighted-code';
import { highlightCode, peekHighlightedCode } from './shiki';

const theme = vi.hoisted(() => ({ value: 'light' }));
vi.mock('../theme', () => ({
  useTheme: () => ({ resolvedTheme: theme.value }),
}));
vi.mock('../i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));
vi.mock('./shiki', () => ({
  peekHighlightedCode: vi.fn(
    (): ReturnType<typeof peekHighlightedCode> => null,
  ),
  highlightCode: vi.fn((code: string, language: string) =>
    Promise.resolve({
      html: `<pre><code><span>${code}</span></code></pre>`,
      language,
    }),
  ),
}));

let observers: TestObserver[];
class TestObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '800px';
  readonly scrollMargin = '';
  readonly thresholds = [0];
  readonly targets = new Set<Element>();
  constructor(private callback: IntersectionObserverCallback) {
    observers.push(this);
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
  }
  takeRecords() {
    return [];
  }
  notify(isIntersecting: boolean) {
    this.callback(
      [...this.targets].map((target) => ({
        target,
        isIntersecting,
        intersectionRatio: isIntersecting ? 1 : 0,
        boundingClientRect: target.getBoundingClientRect(),
        intersectionRect: target.getBoundingClientRect(),
        rootBounds: null,
        time: 0,
      })),
      this,
    );
  }
}

async function setVisible(visible: boolean) {
  await act(async () => {
    for (const observer of observers) observer.notify(visible);
  });
}

beforeEach(() => {
  observers = [];
  theme.value = 'light';
  vi.mocked(highlightCode).mockClear();
  vi.mocked(peekHighlightedCode).mockReturnValue(null);
  vi.stubGlobal('IntersectionObserver', TestObserver);
});
afterEach(() => vi.unstubAllGlobals());

describe('HighlightedCode viewport work', () => {
  it('renders a previously highlighted snippet in its first frame without retokenizing', async () => {
    vi.mocked(peekHighlightedCode).mockReturnValue({
      html: '<pre><code><span>warm</span></code></pre>',
      language: 'js',
    });
    const { container } = render(
      <HighlightedCode code={'warm\n'} language="js" />,
    );
    expect(container.querySelector('code span')).toHaveTextContent('warm');
    expect(peekHighlightedCode).toHaveBeenCalledWith('warm', 'js', 'light');
    await setVisible(true);
    expect(highlightCode).not.toHaveBeenCalled();
  });
  it('keeps all source readable and reuses decoration when re-entering view', async () => {
    const { container } = render(
      <HighlightedCode code="const value = 1;" language="js" />,
    );
    expect(container).toHaveTextContent('const value = 1;');
    expect(highlightCode).not.toHaveBeenCalled();
    await setVisible(true);
    expect(highlightCode).toHaveBeenCalledOnce();
    expect(container.querySelector('code span')).not.toBeNull();
    await setVisible(false);
    await setVisible(true);
    expect(highlightCode).toHaveBeenCalledOnce();
  });

  it('shows changed offscreen source immediately and highlights it when visible', async () => {
    const { container, rerender } = render(
      <HighlightedCode code="old" language="js" />,
    );
    await setVisible(true);
    await setVisible(false);
    rerender(<HighlightedCode code="new" language="js" />);
    expect(container).toHaveTextContent('new');
    expect(container).not.toHaveTextContent('old');
    expect(container.querySelector('code span')).toBeNull();
    expect(highlightCode).toHaveBeenCalledOnce();
    await setVisible(true);
    expect(highlightCode).toHaveBeenLastCalledWith('new', 'js', 'light');
    expect(highlightCode).toHaveBeenCalledTimes(2);
  });

  it('invalidates cached decoration for a different language', async () => {
    const { container, rerender } = render(
      <HighlightedCode code="value" language="js" />,
    );
    await setVisible(true);
    await setVisible(false);
    rerender(<HighlightedCode code="value" language="py" />);
    expect(container.querySelector('code span')).toBeNull();
    await setVisible(true);
    expect(highlightCode).toHaveBeenLastCalledWith('value', 'py', 'light');
    expect(highlightCode).toHaveBeenCalledTimes(2);
  });

  it('invalidates cached decoration for a different theme', async () => {
    const { container, rerender } = render(
      <HighlightedCode code="value" language="js" className="light" />,
    );
    await setVisible(true);
    await setVisible(false);
    theme.value = 'dark';
    rerender(<HighlightedCode code="value" language="js" className="dark" />);
    expect(container.querySelector('code span')).toBeNull();
    await setVisible(true);
    expect(highlightCode).toHaveBeenLastCalledWith('value', 'js', 'dark');
    expect(highlightCode).toHaveBeenCalledTimes(2);
  });
});
