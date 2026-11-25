import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { render } from '@/tests/utils/render';

import { EmailPreview } from './email-preview';

import '@tale/ui/globals.css';

afterEach(cleanup);

function renderedPre(container: HTMLElement) {
  const pre = container.querySelector('pre');
  if (pre === null) throw new Error('No <pre> rendered');
  return pre;
}

/**
 * How a preview dresses a `<pre>`, laid out by a real browser — jsdom
 * resolves no user-agent stylesheet, so only here does a `<pre>` fall back
 * to the monospace font.
 */
describe('EmailPreview in Chromium', () => {
  it('reads a plain-text message in the message font, wrapping, with its line breaks', () => {
    const { container } = render(
      <EmailPreview html={'<pre>Hi there,\nthe invoice is wrong.</pre>'} />,
    );
    const pre = renderedPre(container);
    const style = getComputedStyle(pre);
    expect(style.fontFamily).not.toMatch(/monospace/i);
    expect(style.whiteSpace).toBe('pre-wrap');
    expect(pre.getBoundingClientRect().height).toBeGreaterThan(
      Number.parseFloat(style.lineHeight) * 1.5,
    );
  });

  it('keeps a code block inside an HTML email in monospace', () => {
    const { container } = render(
      <EmailPreview html={'<p>Run this:</p><pre>npm install</pre>'} />,
    );
    expect(getComputedStyle(renderedPre(container)).fontFamily).toMatch(
      /monospace/i,
    );
  });
});
