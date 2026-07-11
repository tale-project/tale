import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { SvgViewer } from './svg-viewer';

/**
 * Regression for #2662: the viewer used to strip `on…=` handlers with a
 * regex (`/\son\w+\s*=.../`), which requires a LEADING SPACE before the
 * attribute — `<svg/onload=…>` (slash-separated, no space) and an unquoted
 * `href=javascript:…` both slipped through. DOMPurify parses the markup as a
 * real DOM tree, so attribute syntax can't be used to dodge it.
 *
 * Regression for the #2662 follow-up: the DOMPurify `svg`/`svgFilters`
 * profiles silently drop `<foreignObject>` and `<use>` entirely (both are
 * absent from those profiles by design), which broke mermaid-style diagrams
 * that render text labels via `<foreignObject><div>…</div></foreignObject>`
 * and shapes reused via `<use href="#id">`. The tests below re-admit both
 * and prove the XSS surface they reopen (foreignObject's HTML children,
 * `<use>`'s href/xlink:href) is still neutralized.
 */
describe('SvgViewer', () => {
  it('neutralizes <svg/onload=…> (no leading space before the handler)', () => {
    const malicious = '<svg/onload=alert(1)><circle r="5"/></svg>';
    const { container } = render(<SvgViewer svg={malicious} />);

    expect(container.innerHTML).not.toContain('onload');
    expect(container.querySelector('svg')?.getAttribute('onload')).toBeNull();
  });

  it('neutralizes an unquoted javascript: href', () => {
    const malicious =
      '<svg xmlns="http://www.w3.org/2000/svg"><a href=javascript:alert(1)><text>click</text></a></svg>';
    const { container } = render(<SvgViewer svg={malicious} />);

    expect(container.innerHTML).not.toContain('javascript:');
    expect(
      container.querySelector('a')?.getAttribute('href') ?? '',
    ).not.toContain('javascript:');
  });

  it('still renders a legitimate SVG', async () => {
    const legit =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" role="img" aria-label="dot"><circle cx="5" cy="5" r="4" fill="currentColor" /></svg>';
    const { container } = render(<SvgViewer svg={legit} />);

    const circle = container.querySelector('circle');
    expect(circle).toBeInTheDocument();
    expect(circle?.getAttribute('fill')).toBe('currentColor');
    await checkAccessibility(container);
  });

  it('renders a <foreignObject> HTML label (mermaid-style diagram text)', () => {
    const diagram =
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><foreignObject width="100" height="30"><div xmlns="http://www.w3.org/1999/xhtml">Hello <b>World</b></div></foreignObject></svg>';
    const { container } = render(<SvgViewer svg={diagram} />);

    const label = container.querySelector('foreignObject div');
    expect(label).toBeInTheDocument();
    expect(label?.querySelector('b')?.textContent).toBe('World');
  });

  it('renders a <use> referencing a local <defs> shape', () => {
    const diagram =
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><circle id="dot" r="5"/></defs><use href="#dot" x="10" y="10"/></svg>';
    const { container } = render(<SvgViewer svg={diagram} />);

    expect(container.querySelector('defs circle#dot')).toBeInTheDocument();
    expect(container.querySelector('use')?.getAttribute('href')).toBe('#dot');
  });

  it('strips a <script> smuggled inside a <foreignObject> child', () => {
    const malicious =
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><script>window.pwned = true;</script>text</div></foreignObject></svg>';
    const { container } = render(<SvgViewer svg={malicious} />);

    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toContain('<script');
  });

  it('strips an onerror handler smuggled inside a <foreignObject> child', () => {
    const malicious =
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(1)"/></div></foreignObject></svg>';
    const { container } = render(<SvgViewer svg={malicious} />);

    expect(container.querySelector('img')?.getAttribute('onerror')).toBeNull();
    expect(container.innerHTML).not.toContain('onerror');
  });

  it('neutralizes a <use> href pointing at a javascript: URL', () => {
    const malicious =
      '<svg xmlns="http://www.w3.org/2000/svg"><use href="javascript:alert(1)" x="10" y="10"/></svg>';
    const { container } = render(<SvgViewer svg={malicious} />);

    expect(container.querySelector('use')?.getAttribute('href')).toBeNull();
    expect(container.innerHTML).not.toContain('javascript:');
  });

  it('neutralizes a <use> xlink:href pointing at an external origin', () => {
    const malicious =
      '<svg xmlns="http://www.w3.org/2000/svg"><use xlink:href="https://evil.example/x.svg#dot" x="10" y="10"/></svg>';
    const { container } = render(<SvgViewer svg={malicious} />);

    const use = container.querySelector('use');
    expect(use?.getAttribute('xlink:href')).toBeNull();
    expect(use?.getAttribute('href')).toBeNull();
    expect(container.innerHTML).not.toContain('evil.example');
  });
});
