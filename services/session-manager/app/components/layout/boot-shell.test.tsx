import { describe, expect, it } from 'vitest';

import { useNavItems } from '@/app/hooks/use-nav-items';
import { renderHookApp } from '@/tests/utils/render';

import { renderBootShell, withBootShell } from './boot-shell';

/*
 * The boot shell: the frame of the app that the built page holds in `#root`
 * (`scripts/prerender-boot-shell.ts`), the first paint of every address until
 * React draws the page in its place. That it lies where the live frame does is
 * held in the browser (`tests/e2e/specs/first-paint.spec.ts`).
 */

/** The shell as nodes of this document, to read its boxes. */
function shell(): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderBootShell();
  return host;
}

describe('the boot shell', () => {
  it('holds no word: the dev server brings the styles with the scripts, and a word would show raw until they came', () => {
    const text = (shell().textContent ?? '')
      .replaceAll(/\s/g, '')
      // The masked labels of the tab bar size themselves with a zero-width space.
      .replaceAll('\u200B', '');
    expect(text).toBe('');
  });

  it('is hidden from assistive technology and has no box of its own', () => {
    const wrapper = shell().firstElementChild;
    expect(wrapper).toHaveAttribute('data-boot-shell');
    expect(wrapper).toHaveAttribute('aria-hidden', 'true');
    expect(wrapper).toHaveAttribute('style', 'display:contents');
  });

  it('masks a tile for every section the rail and the tab bar have, Settings at the foot', () => {
    const { result } = renderHookApp(() => useNavItems());
    const { primary, pinned } = result.current;
    const [sections, foot, ...more] = shell().querySelectorAll('ul');

    expect(more).toHaveLength(0);
    expect(sections?.querySelectorAll('li')).toHaveLength(primary.length);
    expect(foot?.querySelectorAll('li')).toHaveLength(pinned.length);
    expect(
      shell().querySelectorAll('.mobile-tab-bar [data-skeleton-mask="circle"]'),
    ).toHaveLength(primary.length + pinned.length);
  });
});

describe('withBootShell', () => {
  const page = '<body><div id="root"></div><script></script></body>';

  it('puts the shell into the empty #root of a page', () => {
    const shelled = withBootShell(page);
    expect(shelled).toBe(
      `<body><div id="root">${renderBootShell()}</div><script></script></body>`,
    );
  });

  it('leaves a page with no empty #root as it is', () => {
    const shelled = withBootShell(page);
    expect(withBootShell(shelled)).toBe(shelled);
    expect(withBootShell('<body><main></main></body>')).toBe(
      '<body><main></main></body>',
    );
  });
});
