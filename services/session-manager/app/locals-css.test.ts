import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/*
 * The service's own stylesheet, `locals.css`: rules a test in jsdom cannot see
 * at work (it lays nothing out), kept from being dropped by reading them.
 */

const css = readFileSync(join(import.meta.dirname, 'locals.css'), 'utf8');

/** The block of the first rule that starts with `head`, braces included. */
function ruleOf(head: string): string {
  const start = css.indexOf(head);
  if (start === -1) return '';
  let depth = 0;
  for (let at = css.indexOf('{', start); at < css.length; at += 1) {
    if (css[at] === '{') depth += 1;
    if (css[at] === '}') depth -= 1;
    if (depth === 0) return css.slice(start, at + 1);
  }
  return '';
}

describe('locals.css', () => {
  it('fits a browser tab to the viewport that is showing, not the large one behind the toolbar of Safari', () => {
    const rule = ruleOf('@media (display-mode: browser)');
    expect(rule).toMatch(/html,\s*body\s*{\s*height:\s*100dvh;\s*}/);
  });

  it('keeps the document from scrolling by itself: the shell scrolls its own regions', () => {
    expect(ruleOf('html,\nbody,\n#root')).toMatch(/overflow:\s*clip/);
    expect(ruleOf('html,\nbody {\n  overscroll-behavior')).toMatch(
      /overscroll-behavior:\s*none/,
    );
  });

  it('shows the boot shell only once a load takes longer than a blink, never before', () => {
    expect(ruleOf('[data-boot-shell]')).toMatch(
      /animation:\s*boot-shell-reveal\s+1ms\s+linear\s+400ms\s+both/,
    );
    const frames = ruleOf('@keyframes boot-shell-reveal');
    expect(frames).toMatch(/from\s*{\s*visibility:\s*hidden;\s*}/);
    expect(frames).toMatch(/to\s*{\s*visibility:\s*visible;\s*}/);
  });

  it('holds every transition back while the app opens, so its first frame fades nothing in', () => {
    expect(ruleOf(':root[data-opening] *')).toMatch(
      /transition:\s*none\s*!important/,
    );
  });
});
